# ResonanceBreach Species Notes

## Ecology depth layer v1

This pass shifts the simulation from mostly direct birth/death interactions into a cyclical ecology built from **propagules, dynamic environmental fields, decay, and regeneration**.

## Lifecycle model

The core ecological loop is now:

1. **Rooted species mature and release seeds or spores.**
2. **Propagules drift or wait in dormancy** until local conditions become favorable.
3. **Germination creates new life** only when habitat, nutrient availability, temperature, and crowding allow it.
4. **Fruit and biomass are consumed** by mobile species.
5. **Death and waste create residue.**
6. **Residue and decomposers return nutrients** to the local field.
7. **Recovered nutrients support future germination and growth.**

This avoids instant respawn and pushes recovery through local ecological memory instead.

## Continuous environmental fields

Two continuous fields now shape ecological behavior:

- **Nutrients** — a coarse dynamic field layered on top of terrain fertility. Growth drains it, residue and decomposers restore it, and it slowly diffuses / relaxes over time.
- **Temperature** — a coarse dynamic energy field layered on top of terrain. Species have preferred ranges and can locally warm or cool patches through activity.

Together with the terrain-derived moisture, slope, fertility, and habitat weights, these fields make clusters emerge more naturally.

## Resource flows

The live resource economy is intentionally concrete:

- **nutrients** flow from residue, decomposers, and the terrain into rooted growth
- **fruit / biomass** flow from blooms into flockers and grazers
- **energy / temperature** influence which species thrive, linger, or collapse locally

A typical loop now looks like:

**bloom / canopy / ephemeral bloom → fruit or edible biomass → grazer / pollinator / parasite pressure → residue → decomposer → nutrient field → new propagule germination**

## Species roles

### Rooted Bloom (`plant`)
- baseline producer
- basin-favoring rooted species
- balanced seed output, fruiting, and soil support

### Ephemeral Bloom (`ephemeral`)
- fast warm-loving producer
- quick growth, quick decay, high spore output
- rapidly converts nutrient spikes into short-lived biomass

### Canopy Bloom (`canopy`)
- slow rare high-yield producer
- prefers cooler, richer pockets
- fruits heavily but reproduces slowly through deeper-cycle seeds

### Pollinator Drifter (`flocker`)
- mobile pollination and scavenging species
- links bloom patches and boosts fruiting success
- helps spread productivity across clusters

### Grazer (`grazer`)
- group-foraging herbivore
- consumes fruit and mature bloom surplus
- converts biomass into pressure, waste, and residue

### Decomposer (`cluster`)
- residue recycler
- strongest local nutrient returner
- stabilizes collapse zones and helps recovery begin

### Parasitic Tendril (`parasite`)
- stationary / slow creeping feeder
- siphons energy from rooted blooms in warm pockets
- adds local imbalance and residue-rich pressure without acting like an enemy faction

## Stability goals in this pass

The pass is tuned for **dynamic balance**, not equilibrium:

- local bloom crashes can happen
- warm nutrient surges can trigger short-lived ephemeral booms
- decomposers and residue can recover exhausted terrain
- crowding and nutrient draw prevent infinite producer runaway
- propagule dormancy helps the world recover after local depletion

## Debug support added

The HUD diagnostics now expose lightweight ecological hints for:

- propagule counts
- lifecycle transition counts
- richer per-species timing distribution
- nutrient / temperature awareness through the main status readout

## Structured inspection hooks

To support a later inspection-focused pass, entity and propagule state is now organized around explicit read models rather than only raw simulation numbers:

- **species role** — producer / pollinator / grazer / decomposer / parasite
- **lifecycle state** — stage, progress, age ratio, propagule charge, residue yield
- **resource state** — energy, biomass, vitality, hunger, nutrient stress, temperature stress
- **habitat preference** — primary/secondary habitat plus preferred nutrient, moisture, and temperature ranges
- **propagule status** — dormant, ready, germinating, or spent

The current HUD only samples a slice of this, but a future dedicated inspect UI can read it directly without inferring meaning from behavior code.
