# Roulette Royale

Roulette Royale is a 3D European roulette table that runs in the browser: a lacquered mahogany wheel with a brass turret, chrome frets and diamonds, and an ivory ball, next to a green baize layout under a low table lamp, in a dim casino among slot machines, chandeliers and marquee lights. The ball is simulated, not animated: it rides the rim, spirals down the bowl, glances off the diamonds and rattles between the frets until it settles. A crowd of spectators watches every spin, cheers your wins under a shower of confetti, and groans at your losses. Play the [live demo](https://ronpicard.github.io/roulette-royale/) — it works on both phones and desktops.

It plays for credits only. There is no real money, no purchases, and nothing to win.

## How to play

- Pick a chip from the rack (1, 5, 25, 100 or 500 credits) and click or tap the felt to bet. A tap in the middle of a number bets it straight up; a tap on a line between numbers bets the split, corner, street or six line on that line.
- Right-click a stack, or press and hold it on a touch screen, to take it back. `UNDO`, `CLEAR`, `REBET` (the last spin's bets) and `×2` (double everything on the table) do what they say.
- Press `SPIN` when your bets are down. The dealer calls "No more bets" and launches the ball.
- Winning bets are paid, losing chips are swept, and a dolly marks the winning number until you bet again.
- The spectators cheer a win, louder the bigger it pays, and groan in dismay at a loss. They stay quiet when you break even or have no bet down.
- You start with 1,000 credits, and your credits and history are kept in your browser. If you run out, the table offers a refill.
- The camera follows the game by default: the layout while you bet, the wheel while it spins, and a close look at the winning pocket. The camera button or `C` cycles it with three fixed views: seated at the layout, looking into the wheel, and straight down on the table.
- Quick spin runs the wheel at double speed. The outcome of a spin does not change.
- While the menu is up, the table plays itself.

### Keyboard

| Key | Action |
| --- | --- |
| `Space` or `Enter` | Spin |
| `1` to `5` | Select the 1, 5, 25, 100 or 500 chip |
| `Z` or `Backspace` | Undo |
| `X` or `Delete` | Clear the table |
| `R` | Rebet |
| `D` | Double |
| `C` | Change camera |
| `Q` | Quick spin |
| `M` | Mute |
| `Escape` | Menu |

## The bets

| Bet | Covers | Pays |
| --- | --- | --- |
| Straight up | One number | 35 to 1 |
| Split | Two neighbouring numbers | 17 to 1 |
| Street | A row of three | 11 to 1 |
| Trio | 0, 1, 2 or 0, 2, 3 | 11 to 1 |
| Corner | Four numbers meeting at a corner | 8 to 1 |
| First four | 0, 1, 2, 3 | 8 to 1 |
| Six line | Two neighbouring rows of three | 5 to 1 |
| Column | Twelve numbers, the `2 to 1` boxes | 2 to 1 |
| Dozen | 1–12, 13–24 or 25–36 | 2 to 1 |
| Red, black, odd, even, 1–18, 19–36 | Eighteen numbers | 1 to 1 |

Zero loses every outside bet. The house edge is 1/37, about 2.7%, on every bet. Table limits run from 250 on a straight-up number to 5,000 on the even-money bets.

## The physics

The ball is simulated in the plane of the wheel, in inches and seconds, a thousand steps a second. Every band of the wheel has its real slope: the ball track leans slightly inward, the stator cone more steeply, and the number ring down into the pockets. A fast ball presses against the rim and rides it; as friction slows it, the slope wins and it spirals down onto the stator, where eight diamonds can knock it sideways. On the rotor, which turns the other way, it rolls over the number ring, drops over the lip into the pocket ring, and bounces off the frets. A hard hit hops the ball clear of the frets into another pocket; a soft one does not. The ball settles once it has rested in one pocket for a moment, and then rides round with the rotor.

Each spin starts from a random 32-bit seed that sets the release point, the ball's speed and the rotor's speed. After that nothing is random: the same seed always plays the same spin. The test suite simulates hundreds of spins and fails if a ball ever escapes the wheel or fails to settle, if the ball rides the track too briefly or too long, or if the winning numbers are not spread evenly across all 37 pockets. To see the numbers yourself:

```bash
npm run simulate -- 2000
```

This prints the distribution of winning numbers with its chi-square statistic, the drop and settle times, and the return of a session of demo bets against the theoretical 36/37.

## Tech stack

- React 19 and TypeScript for the menu, HUD, chip rack and result banner
- Plain three.js for the table, the wheel and the casino around them: physically based materials, soft shadows under a table lamp, and a light bloom pass for the marquee bulbs. Reflections in the chrome, brass and lacquer are captured from the casino room itself
- Every texture is drawn in code at start-up: the felt layout, the number ring, the chips, the tote board, the carpet, the slot machine reels, and the wood grain and brushed metal maps — no image files
- Web Audio, synthesised in code at runtime — no audio files: the ball, chips and chimes, a lounge trio and vibraphone playing in the background with distant slot machines, and the crowd's cheers and groans
- Vite for building and development
- Node's built-in test runner (`node:test`), no separate test framework
- No backend — credits, history and settings live in `localStorage`
- GitHub Actions and GitHub Pages for continuous deployment

## Project layout

The game logic is kept separate from rendering and input, so the wheel physics, the bets and the session rules can be unit tested without a browser or a canvas:

```text
src/game/    the wheel geometry and physics, seeded spins, the bets and layout, session rules, demo bets and crowd reactions
src/render/  the three.js engine and its public API, the wheel, table, tote board, casino room, spectators and confetti, procedural textures
src/ui/      React components for the menu, HUD and result banner, the canvas mount, and storage
src/audio.ts synthesised sound effects and ambience; src/casinoMusic.ts the background lounge music
scripts/     the headless spin simulator
```

## Development

Requires Node >= 22.12.

Everything under `src/game/` is framework-free — no DOM, no three.js, and no non-deterministic calls like `Math.random` or `Date` — so `npm test` runs directly in Node without spinning up a browser.

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Start the dev server |
| `npm test` | Run the wheel, physics, bet, layout, session and crowd tests |
| `npm run simulate` | Simulate spins headlessly and report the distribution |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview the production build locally |

Add `?quality=high` or `?quality=low` to the address to pin the rendering cost; otherwise the engine steps it down by itself when frames stay slow.

## Deployment

Pushes to `main` run a GitHub Actions workflow that installs dependencies, runs the test suite, builds the production bundle, and publishes the `dist` output to GitHub Pages.

Vite is configured with a relative `base` in `vite.config.ts`, so the built asset paths resolve correctly whether the site is served from the domain root or from a repository subpath like `/roulette-royale/`.

## License

[MIT](LICENSE)
