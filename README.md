# Initiative Editor

A small Foundry VTT module for manually grouping and ordering combat initiatives.

## Features

- Open a GM-only editor from the Combat Tracker header.
- Select combatants manually, from controlled tokens, by player-owned actors, or by NPCs.
- Set selected combatants to a specific initiative such as `0`.
- Set player-owned actors to `10` and everyone else to `0` with one click.
- Drag rows in the editor to immediately apply descending initiative values from that order.
- Drag a checked combatant to move all checked combatants as a group.
- Refresh the editor list when combatants are added or removed.

## Simultaneous turns

Foundry supports ties by giving multiple combatants the same initiative value. That lets the table treat those actors as acting together, but core Foundry still advances through the tied combatants one tracker entry at a time.

This module uses tied initiative values for grouped actors because it stays compatible with normal Foundry combat behavior and other combat-related modules.
