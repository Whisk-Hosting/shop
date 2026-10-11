import * as migration_20261010_150635_initial from './20261010_150635_initial';

export const migrations = [
  {
    up: migration_20261010_150635_initial.up,
    down: migration_20261010_150635_initial.down,
    name: '20261010_150635_initial'
  },
];
