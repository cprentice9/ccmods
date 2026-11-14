# starfield

A theme for the Claude desktop app: the dotted night sky from the foot of claude.dev behind the conversation, with Clawd the astronaut floating in it while Claude works.

## What it does

- **Sky.** A grid of gray dots on the app's own dark gray, with a crescent moon upper left and a ringed planet lower right. The dot clouds fade slowly between two shapes.
- **Clawd.** While a turn runs, Clawd floats near the middle of the window in a space helmet, cycling the 68 frames of his floating loop at 12 frames a second. He leaves when the turn ends.
- **Minis.** Each running subagent gets a smaller astronaut near the edges, up to eight. A mini keeps its spot when another one finishes.
- **`/starfield`.** Puts the theme back after another mod set its own. One theme stands at a time.

The app's colors stay as they are. Only the desktop and mobile apps draw a theme, so the terminal shows nothing. The scene is made for dark mode.

## Loading it

It isn't on a marketplace. Clone the repo and load the folder:

```bash
git clone https://github.com/cprentice9/ccmods.git
```

```bash
claude --plugin-dir ccmods/starfield
```

## Writing a scene like it

Never put `shape-rendering="crispEdges"` in a theme's scene. With it on any element, even one inside unused `<defs>`, the desktop app holds every animation in the scene still. The same SVG animates in a plain browser frame, so a local test does not show it. To keep pixel art sharp, each path here has a hairline stroke in its own fill color.

The hook that draws the scene answers at once from values the module already holds, and sends the same markup until Clawd or a mini comes or goes. A new source reloads the scene's frame and restarts its motion.

## Where the art comes from

The sky is a port of the star field at the foot of claude.dev, and Clawd's frames are sampled from the astronaut there. Both are Anthropic's.
