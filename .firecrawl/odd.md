**TITAN ODD WAY — AI DRAW & MANUAL EDITING REQUIREMENTS**

**AI GENERATED DRAW**

Titan should generate the best possible draw across all tournament rounds using the existing AI scheduling functionality.

The AI should aim to:

- Maximise the number of different people every golfer plays with
- Maximise exposure to players from different teams
- Keep teammates separated wherever possible
- Avoid repeat playing partners/opponents
- Never automatically place an entire team together
- Consider every round of the tournament when creating the draw

However, the AI-generated draw is **only the starting point**.

The tournament organiser must retain full control over the draw after it has been generated.

**MANUAL EDITING AFTER AI GENERATION**

Once Titan has generated the draw, the organiser must be able to manually move players between playing groups.

The organiser must NOT have to regenerate the entire draw simply because they want to move one player.

For example:

**AI Generated Round 2**

Group 1:

- Ricky
- George
- Darren
- Tony

Group 2:

- Levi
- Stuart
- Ross
- John

The organiser may decide they want Ricky to play in Group 2 instead.

They should be able to select Ricky and use:

**Move Player**

or preferably:

**Drag and Drop**

to move Ricky into another group.

**MOVING PLAYERS**

The organiser should be able to:

- Drag a player from one group to another
- Select a player and choose **Move Player**
- Swap two players between groups
- Move a player into a group with a vacant position
- Change the player's group within any tournament round
- Change the player's tee time by moving them to another group
- Reorder players within a group if required

All of this must be possible **after an AI draw has been generated**.

**SWAP PLAYER**

Provide a simple:

**Swap Player**

function.

Example:

Group 1 contains Ricky.

Group 4 contains Stuart.

The organiser selects:

**Ricky → Swap → Stuart**

Titan swaps their positions without affecting any of the other players or groups.

This is especially useful when all groups already contain four players.

**DO NOT AUTOMATICALLY REGENERATE**

A manual player move must NOT cause Titan to regenerate the rest of the draw.

If the organiser moves one player, Titan should only make the requested change.

All other groups and rounds must remain exactly as they were.

The organiser remains in control.

**VALIDATION AFTER A MANUAL MOVE**

After a player is moved or swapped, Titan should instantly re-check the draw.

Check for:

- Group size
- Duplicate player
- Same-team players
- Full team accidentally placed together
- Repeat playing partners
- Reduced opponent variety
- Player appearing in more than one group in the same round

Titan should show useful warnings without unnecessarily preventing the organiser from making changes.

Example:

**⚠ Ricky and Levi are both members of Elite.**

or:

**⚠ Ricky has already played with Stuart twice during this tournament.**

or:

**⚠ This change reduces Ricky's unique opponents from 10 to 9.**

These are advisory warnings.

**HARD VALIDATION**

Titan should prevent genuinely invalid scheduling situations.

For example:

- The same player appearing in two groups in the same round
- More players in a group than the configured maximum
- A player being assigned to a round they are unavailable for

For normal Titan Odd Way tournaments, fourballs should normally contain a maximum of four players.

If a destination group is already full, Titan should offer:

**Swap Player**

rather than simply adding a fifth player.

**TEAM SEPARATION WARNING**

Titan should continue trying to avoid teammates playing together.

The AI should treat team separation as a major scheduling priority.

However, because the organiser has manual control, Titan should warn rather than silently change an organiser's manual decision.

Example:

**⚠ This move will put two Elite players in the same fourball. Continue?**

A full tournament team being placed together should receive a much stronger warning:

**⚠ This group would contain the entire Elite team. Titan Odd Way is designed to spread team members across the field.**

The AI itself must never automatically generate a full team together.

**MANUAL CHANGES MUST BE PRESERVED**

Once an organiser manually moves or swaps a player, Titan must remember that adjustment.

Manual changes must not disappear when:

- The screen is refreshed
- The organiser changes rounds
- Scores are entered
- The tournament is saved
- The draw is published

The manual draw becomes the current official draw.

**REGENERATING AFTER MANUAL CHANGES**

If the organiser subsequently selects:

**Regenerate Draw**

Titan should ask how the organiser wants to handle manual changes.

Options:

**Keep My Changes**

Preserve all manually moved/swapped players and regenerate the remaining draw around them.

**Start Again**

Remove the manual changes and create a completely new AI draw.

The default should be:

**Keep My Changes**

This prevents an organiser accidentally losing work they have already done.

**LOCK MANUAL CHANGES**

Any manually adjusted player/group should preferably be automatically treated as **locked** when using **Keep My Changes**.

Example:

The organiser moves Ricky into Group 4 for Round 3.

Later they ask Titan to regenerate the other groups.

Ricky remains in Group 4 and the AI optimises everyone else around that decision.

The organiser should also be able to manually:

**Lock Player**

**Lock Group**

**Unlock**

**DRAW QUALITY AFTER EDITING**

After a manual move, Titan can recalculate the draw quality in real time.

For example:

**Draw Quality: 94% → 92%**

Then show why:

- 2 additional repeat pairings
- 1 same-team pairing created
- All players still meet at least 9 unique opponents

This should be informational only.

It allows the organiser to understand the impact of their changes without taking control away from them.

**DESIRED USER EXPERIENCE**

The workflow should be:

**Generate Titan Draw**

↓

Titan creates the best possible tournament-wide draw

↓

Organiser reviews groups

↓

Organiser can drag, move or swap any player

↓

Titan highlights any scheduling issues

↓

Organiser makes further changes if required

↓

Save Draw

↓

Publish Draw

The key principle is:

**AI creates the draw. The organiser always remains in control.**

The organiser should never feel locked into what the AI has generated.
