import manifest from '../../package.json'
export const updateConfig = {
  package: manifest.name, version: manifest.version, repository: 'Star1ver-an/dsh-poker',
  asset: 'dsh-local-poker', service: 'pokerUpdates', domain: 'local_poker_updates',
}
