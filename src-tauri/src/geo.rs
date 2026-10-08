//! Geocoding HTTP from the native side.
//!
//! The webview cannot call geocoding.geo.census.gov: Census sends no CORS
//! headers, so every browser `fetch` failed, the Census circuit opened after 3
//! errors, and every remaining row fell through to Google (quota drain). This
//! module makes the GET from Rust instead, where CORS does not apply.
//!
//! Scope is fixed here, not in the webview: https only, three exact hosts, one
//! path each, no credentials or custom ports. The URL may carry the Google key
//! as a query parameter, so URLs are never logged and errors are returned
//! without the URL.

use std::time::Duration;

use serde::Serialize;

/// Nominatim's usage policy asks for an identifying User-Agent.
pub const USER_AGENT: &str = concat!(
    "DispatchBoardLocal/",
    env!("CARGO_PKG_VERSION"),
    " (single-user desktop; Fredericksburg VA)"
);

const TIMEOUT: Duration = Duration::from_secs(15);
const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Provider {
    Census,
    Google,
    Nominatim,
}

impl Provider {
    pub fn parse(raw: &str) -> Result<Self, String> {
        match raw {
            "census" => Ok(Self::Census),
            "google" => Ok(Self::Google),
            "nominatim" => Ok(Self::Nominatim),
            _ => Err("Unknown geocoder.".into()),
        }
    }

    fn host(self) -> &'static str {
        match self {
            Self::Census => "geocoding.geo.census.gov",
            Self::Google => "maps.googleapis.com",
            Self::Nominatim => "nominatim.openstreetmap.org",
        }
    }

    fn path_ok(self, path: &str) -> bool {
        match self {
            Self::Census => {
                path == "/geocoder/locations/onelineaddress" || path == "/geocoder/locations/address"
            }
            Self::Google => path == "/maps/api/geocode/json",
            Self::Nominatim => path == "/search",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Census => "Census geocoder",
            Self::Google => "Google geocoder",
            Self::Nominatim => "Street lookup",
        }
    }
}

/// Only the three geocoder endpoints. Anything else is refused before any I/O.
pub fn validate(provider: Provider, raw: &str) -> Result<reqwest::Url, String> {
    let refuse = || format!("{} request refused: URL is outside the geocoder scope.", provider.label());
    let url = reqwest::Url::parse(raw).map_err(|_| refuse())?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.host_str() != Some(provider.host())
        || !provider.path_ok(url.path())
        || url.fragment().is_some()
    {
        return Err(refuse());
    }
    Ok(url)
}

#[derive(Debug, Serialize)]
pub struct GeoResponse {
    pub status: u16,
    pub body: String,
}

pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

/// GET one geocoder URL. Returns status + body text; the caller parses JSON.
/// Transport errors come back without the URL (it can hold the Google key).
pub async fn get(client: &reqwest::Client, provider: Provider, raw: &str) -> Result<GeoResponse, String> {
    let url = validate(provider, raw)?;
    let res = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|err| format!("{} failed: {}", provider.label(), err.without_url()))?;
    let status = res.status().as_u16();
    let bytes = res
        .bytes()
        .await
        .map_err(|err| format!("{} failed: {}", provider.label(), err.without_url()))?;
    if bytes.len() > MAX_BODY_BYTES {
        return Err(format!("{} failed: response too large.", provider.label()));
    }
    Ok(GeoResponse {
        status,
        body: String::from_utf8_lossy(&bytes).into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_the_three_geocoders() {
        assert!(validate(
            Provider::Census,
            "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=x&benchmark=Public_AR_Current&format=json"
        )
        .is_ok());
        assert!(validate(Provider::Census, "https://geocoding.geo.census.gov/geocoder/locations/address?street=x").is_ok());
        assert!(validate(Provider::Google, "https://maps.googleapis.com/maps/api/geocode/json?address=x&key=k").is_ok());
        assert!(validate(Provider::Nominatim, "https://nominatim.openstreetmap.org/search?q=x&format=jsonv2").is_ok());
    }

    #[test]
    fn refuses_everything_else() {
        for (p, url) in [
            (Provider::Census, "http://geocoding.geo.census.gov/geocoder/locations/address?street=x"),
            (Provider::Census, "https://geocoding.geo.census.gov.evil.test/geocoder/locations/address"),
            (Provider::Census, "https://geocoding.geo.census.gov:8443/geocoder/locations/address"),
            (Provider::Census, "https://user@geocoding.geo.census.gov/geocoder/locations/address"),
            (Provider::Census, "https://geocoding.geo.census.gov/geocoder/geographies/address"),
            (Provider::Google, "https://maps.googleapis.com/maps/api/directions/json?key=k"),
            (Provider::Google, "https://nominatim.openstreetmap.org/search?q=x"),
            (Provider::Nominatim, "https://nominatim.openstreetmap.org/reverse?lat=1&lon=2"),
            (Provider::Nominatim, "file:///etc/passwd"),
            (Provider::Nominatim, "not a url"),
        ] {
            assert!(validate(p, url).is_err(), "{url} should be refused");
        }
        assert!(Provider::parse("routes").is_err());
    }

    /// Live smoke (network): the yard must land in ZIP 22407 through this exact
    /// native path. Ignored by default; CI runs it with `--include-ignored`.
    /// Tries the one-line form the app sends (with and without ZIP) and the
    /// structured form; prints every answer so a miss is visible in the log.
    #[test]
    #[ignore]
    fn live_yard_geocodes_to_22407() {
        let census = [
            "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=1600%20Beulah%20Salisbury%20Dr%2C%20Fredericksburg%2C%20VA%2022407&benchmark=Public_AR_Current&format=json",
            "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=1600%20Beulah%20Salisbury%20Dr%2C%20Fredericksburg%2C%20VA&benchmark=Public_AR_Current&format=json",
            "https://geocoding.geo.census.gov/geocoder/locations/address?street=1600%20Beulah%20Salisbury%20Dr&city=Fredericksburg&state=VA&zip=22407&benchmark=Public_AR_Current&format=json",
        ];
        let client = client();
        let mut hit = None;
        for (i, url) in census.iter().enumerate() {
            let res = tauri::async_runtime::block_on(get(&client, Provider::Census, url)).expect("census GET");
            let v: serde_json::Value = serde_json::from_str(&res.body).unwrap_or(serde_json::Value::Null);
            let m = &v["result"]["addressMatches"][0];
            let matched = m["matchedAddress"].as_str().unwrap_or_default().to_string();
            println!(
                "yard census form {}: http {} match {:?} ({}, {})",
                i + 1,
                res.status,
                matched,
                m["coordinates"]["y"],
                m["coordinates"]["x"]
            );
            if hit.is_none() && matched.ends_with("22407") {
                hit = Some(matched);
            }
        }
        // Control: a long-standing Fredericksburg address, proves the Rust path parses Census matches.
        let control = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=715%20Princess%20Anne%20St%2C%20Fredericksburg%2C%20VA%2022401&benchmark=Public_AR_Current&format=json";
        if let Ok(res) = tauri::async_runtime::block_on(get(&client, Provider::Census, control)) {
            let v: serde_json::Value = serde_json::from_str(&res.body).unwrap_or(serde_json::Value::Null);
            println!("control census (info): http {} match {:?}", res.status, v["result"]["addressMatches"][0]["matchedAddress"]);
        }
        let osm = "https://nominatim.openstreetmap.org/search?q=1600%20Beulah%20Salisbury%20Dr%2C%20Fredericksburg%2C%20VA%2022407&format=jsonv2&addressdetails=1&countrycodes=us&limit=1";
        if let Ok(res) = tauri::async_runtime::block_on(get(&client, Provider::Nominatim, osm)) {
            let v: serde_json::Value = serde_json::from_str(&res.body).unwrap_or(serde_json::Value::Null);
            let r = &v[0];
            println!(
                "yard nominatim (info): http {} {:?} postcode {} rank {}",
                res.status, r["display_name"], r["address"]["postcode"], r["place_rank"]
            );
        }
        assert!(hit.is_some(), "no Census form matched the yard in 22407");
        println!("yard census match: {}", hit.unwrap());
    }

    #[test]
    fn refusal_never_echoes_the_url() {
        let err = validate(Provider::Google, "https://evil.test/maps/api/geocode/json?key=SECRET").unwrap_err();
        assert!(!err.contains("SECRET"));
    }
}
