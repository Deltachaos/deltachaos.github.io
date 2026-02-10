---
layout: post
title:  "DeltaChess: a chess engine rabbit hole inside World of Warcraft"
date:   2026-02-10 18:00:00 +0100
categories: it
draft: false
lang: en
---

It started as a dumb bet with a guildmate:
**“Can you write a fully handwritten chess program in under 7 hours?”**

Seven hours later I had something that *kind of* moved pieces around — a tiny **Python** console program that could draw a
board and accept moves. Nothing fancy. No UI. No clocks. Barely any rules. But it was *mine*, and it worked enough to be
fun.

Then another friend said the sentence that doomed my free time:

**“Okay… but what if this was a World of Warcraft addon?”**

And that idea was too good to ignore. So I started over — different language, different constraints, different everything.
The result is **DeltaChess**: chess inside WoW, against other players (including cross‑realm where WoW allows) or against
the computer.

If you want to peek at it later: [CurseForge](https://www.curseforge.com/wow/addons/deltachess) / [GitHub](https://github.com/Deltachaos/DeltaChess)

## Chess in a place that really doesn’t want chess

Writing chess code is one thing. Writing chess code in the WoW Lua sandbox is another.

In Python on the console, “just compute for a bit longer” is an acceptable strategy. In WoW, it’s a great way to make the
game hitch and drop frames. So the project quickly became about constraints:

- **Rules correctness**: castling, en passant, promotion, draw rules… the boring parts that make it “real chess”.
- **Responsiveness**: engines must **yield** work so the game keeps rendering smoothly.
- **Determinism and safety**: don’t crash your UI because an engine tried something illegal.

Here’s what the board looks like today:

![DeltaChess board view](/assets/images/2026/02/deltachess-board.png)

And the “play vs computer” flow that wires the UI into the engine framework:

![DeltaChess vs computer dialog](/assets/images/2026/02/deltachess-vs-computer.png)

PGN export was a must-have (because what’s the point of blundering in WoW if you can’t paste it into Lichess later?):

![DeltaChess PGN export](/assets/images/2026/02/deltachess-pgn-export.png)

## The part I didn’t expect: I actually learned chess programming

I used a fair amount of AI assistance for UI and addon glue code, but the engine side pulled me into the classic chess
programming rabbit hole: search, evaluation tradeoffs, move generation pitfalls, and performance tricks you only learn
once you can *feel* the branching factor.

Some highlights of what I ended up (re-)learning:

- **UCI (Universal Chess Interface)**: the lingua franca for “engine talks to GUI”.
  I built a small UCI wrapper so I could run and test the Lua engines from the outside world (and compare behaviors).
- **Minimax → Negamax**: switching from “two-player min/max” to “one function + sign flip” is one of those “why didn’t I
  do this earlier?” moments.
- **Alpha–Beta pruning**: the first time you watch node counts collapse because your move ordering improved, it’s
  addictive.

And on a purely personal level: it was a nice excuse to refresh my **Lua** knowledge (including the parts you only
remember once you write something non-trivial and performance-sensitive).

## A pluggable, async engine framework (because WoW demands it)

DeltaChess ships with a small engine framework that tries to make the hard parts boring:

- Engines are **stateless**: each calculation gets a position + options; no hidden global state required.
- The runner is **single-threaded and async**: engines can yield via a callback so computations spread across frames.
- Every move is validated: if an engine returns an illegal move, it’s caught immediately.

### The real reason the framework exists: testing outside of WoW

One of the biggest practical problems early on wasn’t even search or evaluation — it was **testing**.

Inside WoW I couldn’t easily run automated tests that would tell me whether an engine always produces **legal** moves,
and whether the move generator behaves **consistently** across thousands of positions. Debugging that kind of thing by
hand, in a UI, is misery.

So I extracted the whole “business logic” (rules + move generation) *and* the engines into a separate project that can
run completely outside the WoW environment. That gave me a proper **automated test suite** where engines can self-play
and every returned move is validated for legality.

The framework also supports **ELO-based difficulty selection** and ships with four engines spanning roughly beginner to
very strong:

| Engine | Notes |
|--------|------|
| **Dumb Goblin** | “Capture the highest thing” style — great for absolute beginners |
| **Sunfish** | MTD-bi + iterative deepening + transposition tables |
| **GarboChess** | Alpha–beta with classic pruning/ordering heuristics (null move, killers, SEE, …) |
| **Fruit 2.1** | A historically influential engine with a bag of serious search tricks (LMR, history heuristics, tapered eval, …) |

Huge thanks to **Chessforeva** and their Lua chess work, especially the [`Lua4chess`](https://github.com/Chessforeva/Lua4chess)
repository. They had already ported several classic engines to Lua, which made them *way* easier to integrate.

There was one catch though: those ports were written in a more “normal” style where you just… calculate until you’re
done. In WoW’s single-threaded UI, that meant the game could hang for several seconds whenever an engine thought too long.

So a big chunk of the project ended up being **rewriting/adapting the engines** to allow **async execution** in an event
loop: do some work, yield, resume next frame, repeat — so the game stays responsive while the engine is searching.

If you’re curious, the engine framework lives here: [deltachess-engine-framework](https://github.com/Deltachaos/deltachess-engine-framework)

## Where I’m stuck: ELO calibration for slow Lua engines

This is the part where I’d love advice from people who have done this “for real”.

The engines are written in **Lua** (because WoW), so they’re *slow* compared to typical C/C++ engines. I tried running
tournaments via cutechess, but getting anything remotely stable takes an absurd amount of time.

My goal isn’t perfect scientific accuracy—I just want players to pick an AI opponent that roughly matches their strength,
instead of random “difficulty” labels.

So if you have experience with engine testing and rating, I’d appreciate any pointers:

- Are there smarter ways to **estimate / approximate ELO** for slow engines without weeks of round-robin games?
- Any good approaches for **calibrating across very different environments** (fast desktop vs WoW sandbox)?
- Any tricks for **cutting down match counts** without totally ruining the numbers (SPR T-tests, sequential testing,
  smarter opponent selection, etc.)?

If you try DeltaChess, skim the code, or have “don’t do this, it’s a bad idea” comments—please let me know. This was
never meant to be a serious engine project, but it definitely pushed me down the rabbit hole, and I’d love to learn
more.

