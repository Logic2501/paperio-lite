# Paper.io Lite Textless UI Roadmap

Goal: reduce language dependence and move the game toward a traffic-sign-like interface that can be understood without Chinese or English.

## Near-Term Replacements

- Top HUD
  - Territory bar: keep percentage digits for now, replace the hidden label with a land/area icon later.
  - Timer / endless state: use a clock icon for timed and an infinity icon for endless.
  - Restart: replace text with a circular arrow icon.
  - Mode switch: replace text with timed/endless pictograms instead of words.

- Mobile controls
  - Menu: replace text with a grid/menu icon.
  - Pause: current icon can stay.
  - Direction pad: current triangle arrows can stay.

- Status overlays
  - Countdown: keep digits only.
  - Warning / respawn / elimination banners: replace sentence banners with icon + number patterns where possible.

## Needs Graphic Semantics First

- Start screen
  - Demo lobby, custom options, and mode selection need a consistent pictogram language before removing text.
  - AI count, speed, board size, and suppression need icon legends that are still clear for first-time players.

- Final results
  - Rankings can move toward icon-first layout, but title/caption treatment needs a dedicated design pass.
  - Titles such as `【终产者】`, `【闪电战】`, and `【功亏一篑】` remain text because they are reward labels, not functional UI.

- Sidebar / onboarding
  - Current desktop help copy should become a visual legend panel with gesture, loop, trail-cut, and danger icons.

## Keep For Now

- Menu configuration labels in the start screen
- Final results subtitles
- Desktop event log text

## Design Rules

- Favor high-contrast icons with one meaning each.
- Avoid icons that need tooltips to be understood.
- If a symbol is ambiguous, pair it with color or motion before adding text back.
- Functional UI should prefer numbers, shapes, and motion cues; titles can remain textual.
