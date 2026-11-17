# Mafya – game rules (9-player room)

The server is the narrator ("god"). Everything below is enforced by `game.js` / `server.js`.
Lines marked **[assumed]** were not specified and are my default; change them if wrong.

## Roles (9 players, 3 mafia — one mafia per 3 players)

| Team | Role | Night ability |
|---|---|---|
| Mafia | **Baba** (Godfather) | Picks who dies. One-time shield against the Sniper's shot. Shows as "good" to the Gözcü. |
| Mafia | **Matador** | Blocks one city player's ability for that night (the player is told). Cannot pick the same person two nights in a row. |
| Mafia | **Kötü Doktor** | Protects one mafia member (himself too) from the Sniper. No limits. |
| City | **Doktor** | Protects one player from the mafia kill. Himself only once per game. Same person at most 2 nights in a row, then must pick someone else for a night. |
| City | **Keskin Nişancı** (Sniper) | Total shots = mafia count − 1 (2), max 1 per night, optional. Hits mafia → mafia dies (unless shield/Kötü Doktor; the shot is still spent). Hits city → only the Sniper leaves. |
| City | **Büyücü** | Once per game, brings a dead player back. If it's a mafia, everyone is told a mafia came back (and who). |
| City | **Gözcü** | Asks about one player each night: "Mafya" or "İyi". Baba shows "İyi". |
| City | **Susturucu** | Optionally silences one player for the next day (they can still vote). **[assumed]** not himself. |
| City | **Silahçı** | Once per game gives a gun to a player he trusts. |

### 12 players (4 mafia, 8 city) — the 9 above plus

| Team | Role | Ability |
|---|---|---|
| Mafia | **Terörist** | If voted out during the day, he takes one living player with him (20 s to pick). |
| City | **Pehlivan** | Two lives: the mafia kill fails twice, the third works. |
| City | **Vatandaş** | No ability. |

### 16 players (5 mafia, 11 city) — the 12 above plus

| Team | Role | Ability |
|---|---|---|
| Mafia | **Mafya** | No ability, mafia team. |
| City | **Fedai** | Once, at any moment of the day (speeches, defence, voting): he leaves the game and takes one player with him. Night falls immediately. |
| City | **Vatandaş** ×2 | No ability. |

**Sniper shield (all sizes):** the first mafia kill on the Keskin Nişancı fails; the second works.
A Doktor save does not use up the Sniper's shield or a Pehlivan life.

**Mafia guess:** at night the mafia may guess "player X is role Y" (any special city role, not Vatandaş). Right → that player also leaves. Every guess, right or wrong, uses one right: 1 per game with 9 or 12 players, 2 with 16. Nothing protects against it.

**Gun:** the holder may use it once, during their own speaking turn. Target is mafia → that mafia leaves, no vote today, night starts. Target is city → everyone learns they are good, nobody leaves, night starts.
**[assumed]** the gun works the same in a mafia player's hands.

**Matador block** stops that night's ability: no save, no shot (the shot is not spent), no query, no silence, no gun given, no revive (not spent).
**[assumed]** If Baba is dead, the next living mafia member picks the kill.
**[assumed]** Kötü Doktor protection is checked before the shield, so a protected Baba keeps his shield.

## Flow

1. **Lobby** – the game starts automatically 10 s after the room reaches 9 players.
2. **Day 1 (introductions)** – everyone speaks 50 s in seat order. No vote.
3. **Night 1** – only the mafia wake up for 20 s and see each other (voice + chat between them). No actions.
4. **Morning** – the narrator says who left the game (roles are not shown). If there are dead players, a quick yes/no vote: if most living players say yes, everyone sees how many of the dead were city and how many mafia (not who).
5. **Day** – everyone alive speaks 50 s (silenced players are skipped), going round the table.
   Day 1 starts at a random seat; each later day starts **mafia count** seats further (e.g. seat 3 with 4 mafia → seat 7 next day). If that player is out, the next living one starts.
   **Challenge:** once per day, a player who has already spoken can ask the current speaker for 30 s. If the speaker accepts, the requester gets 30 s **extra** after the speaker's turn.
6. **Vote** – everyone may vote for as many players as they like. Needed votes = half of living players, rounded up (9 → 5, 8 → 4, 7 → 4).
   Everyone who reaches it gets 50 s defence, then a second vote among them only. Still reaching it: one → out; several → coin flip, the loser leaves. Nobody → nobody leaves.
7. **Night** – all night roles act at the same time (45 s), mafia can talk to each other. Then back to 4.

**Winning:** city wins when every mafia is gone. Mafia wins when, as night falls, mafia ≥ city.
Dead players stay as spectators and hear the day, but see roles only when the game ends.

