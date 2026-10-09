//! Remember the window's size and place between launches.
//!
//! Saved to `window-state.json` in the app config folder when the window closes
//! and applied at startup, but only if it still fits on a connected screen, so a
//! window left on an unplugged monitor does not open out of reach.

use serde::{Deserialize, Serialize};
use std::path::Path;

const FILE: &str = "window-state.json";
const MIN_W: u32 = 900;
const MIN_H: u32 = 640;

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub struct WinState {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

/// A monitor's top-left corner and size in physical pixels.
pub type Screen = (i32, i32, u32, u32);

pub fn load(config: &Path) -> Option<WinState> {
    let raw = std::fs::read_to_string(config.join(FILE)).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn save(config: &Path, state: &WinState) {
    if let Ok(json) = serde_json::to_string(state) {
        let _ = std::fs::write(config.join(FILE), json);
    }
}

/// True when enough of the title bar is on some screen to grab it, and the size is sane.
pub fn fits(state: &WinState, screens: &[Screen]) -> bool {
    if state.width < MIN_W || state.height < MIN_H || state.width > 20_000 || state.height > 20_000 {
        return false;
    }
    // A 160 px wide, 40 px tall strip at the top of the window must overlap a screen.
    let (sx, sy, sw, sh) = (state.x as i64, state.y as i64, 160i64.min(state.width as i64), 40i64);
    screens.iter().any(|&(mx, my, mw, mh)| {
        let (mx, my, mw, mh) = (mx as i64, my as i64, mw as i64, mh as i64);
        sx < mx + mw && sx + sw > mx && sy < my + mh && sy + sh > my
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: Screen = (0, 0, 1920, 1080);
    fn st(x: i32, y: i32, w: u32, h: u32) -> WinState {
        WinState { x, y, width: w, height: h, maximized: false }
    }

    #[test]
    fn normal_window_fits() {
        assert!(fits(&st(100, 50, 1400, 900), &[SCREEN]));
    }

    #[test]
    fn window_on_an_unplugged_monitor_does_not() {
        assert!(!fits(&st(2500, 100, 1400, 900), &[SCREEN]));
        assert!(fits(&st(2500, 100, 1400, 900), &[SCREEN, (1920, 0, 1920, 1080)]));
    }

    #[test]
    fn title_bar_off_the_top_does_not() {
        assert!(!fits(&st(100, -400, 1400, 900), &[SCREEN]));
    }

    #[test]
    fn tiny_or_huge_sizes_are_rejected() {
        assert!(!fits(&st(0, 0, 300, 200), &[SCREEN]));
        assert!(!fits(&st(0, 0, 50_000, 900), &[SCREEN]));
    }

    #[test]
    fn round_trips_through_disk() {
        let dir = std::env::temp_dir().join(format!("dbl-win-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let s = WinState { x: 10, y: 20, width: 1300, height: 800, maximized: true };
        save(&dir, &s);
        assert_eq!(load(&dir), Some(s));
        std::fs::write(dir.join(FILE), "not json").unwrap();
        assert_eq!(load(&dir), None);
    }
}
