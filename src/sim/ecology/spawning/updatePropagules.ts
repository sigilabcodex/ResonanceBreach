import type { SpawningRuntimeContext } from './types';
import { clamp, lerp } from './types';

export const updatePropagules = (context: SpawningRuntimeContext, dt: number): void => {
  const next = [];
  for (const propagule of context.getPropagules()) {
    propagule.age += dt;
    const flow = context.sampleField(propagule.position.x, propagule.position.y).flow;
    if (propagule.kind === 'spore') {
      propagule.velocity.x = lerp(propagule.velocity.x, flow.x * 0.14, dt * 0.6);
      propagule.velocity.y = lerp(propagule.velocity.y, flow.y * 0.14, dt * 0.6);
    } else {
      propagule.velocity.x *= Math.pow(0.92, dt * 60);
      propagule.velocity.y *= Math.pow(0.92, dt * 60);
    }
    propagule.position = context.wrapPosition({
      x: propagule.position.x + propagule.velocity.x * dt,
      y: propagule.position.y + propagule.velocity.y * dt,
    });

    const sample = context.sampleField(propagule.position.x, propagule.position.y);
    const ready = propagule.age >= propagule.dormancy;
    const counts = context.countEntities();
    const withinCap = counts[propagule.species] < context.maxBySpecies[propagule.species];
    const density = context
      .getNeighborsAtPosition(propagule.position, propagule.species === 'canopy' ? 120 : 84)
      .filter((candidate) => candidate.type === propagule.species)
      .length;
    const suitability = context.getEntitySpawnSuitability(propagule.species, sample)
      + sample.nutrient * 0.28
      + (propagule.species === 'ephemeral'
        ? sample.temperature * 0.22
        : propagule.species === 'canopy'
          ? (1 - Math.abs(sample.temperature - 0.42)) * 0.16
          : 0);
    const germinationRate = dt * clamp(0.01 + suitability * 0.035 - density * 0.008 + propagule.viability * 0.02, 0.002, 0.08);
    if (ready && withinCap && context.random() < germinationRate) {
      const entity = context.createEntity(propagule.species, propagule.position);
      entity.age = propagule.kind === 'seed' ? context.randomRange(0, entity.lifeSpan * 0.06) : 0;
      entity.energy = clamp(entity.energy + propagule.nutrient * 0.28, 0, 1.3);
      context.entities.push(entity);
      context.removePropaguleById(propagule.id);
      context.incrementGerminations();
      context.emitWorldEvent({ type: 'entityBorn', time: context.now, position: { ...entity.position }, entityType: entity.type, entityId: entity.id });
      continue;
    }
    if (propagule.age < propagule.dormancy + 90 && propagule.viability > 0.04) {
      propagule.viability = clamp(propagule.viability - dt * 0.0012 + sample.nutrient * dt * 0.0006, 0, 1);
      next.push(propagule);
    } else {
      context.affectEnvironment(propagule.position, 24, propagule.nutrient * 0.08, -0.002);
      context.removePropaguleById(propagule.id);
    }
  }
  context.setPropagules(next);
};
