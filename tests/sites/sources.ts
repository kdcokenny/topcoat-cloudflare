export interface Site {
  id: string;
  repository: string;
  revision: string;
  license: string;
  directory: string;
  example?: string;
}

export const sites: Site[] = [
  {
    id: 'showcase',
    repository: 'tokio-rs/topcoat',
    revision: '132bdc62f39b16fb13620cf4e3e6b4526d960211',
    license: 'MIT',
    directory: 'examples/ui',
    example: 'examples/ui',
  },
  {
    id: 'quiz',
    repository: 'AlexPiquard/topcoat-quiz',
    revision: 'a31d817e31d755aca4c9461b10f51244962aadee',
    license: 'GPL-3.0',
    directory: '.',
    example: 'examples/api',
  },
  {
    id: 'coldfront',
    repository: 'superposition/coldfront',
    revision: 'de07388357de1ea74a871b0a801642fa065dbd9a',
    license: 'MIT',
    directory: 'apps/coldfront',
  },
  {
    id: 'blocks',
    repository: 'superposition/topcoat-blocks',
    revision: 'e86eb31560beaf920852e12ab839a8d064107354',
    license: 'MIT',
    directory: 'apps/workbench',
  },
  {
    id: 'f4y',
    repository: 'edinsonjim/f4y-example',
    revision: 'f6aa014be8a086400ba8d3e9f33e81b933104589',
    license: 'MIT',
    directory: '.',
    example: 'examples/d1',
  },
  {
    id: 'gitcoat',
    repository: 'Tryanks/GitCoat',
    revision: '6195ace2eec6c0fe60c5aff753ed41ddf9d62492',
    license: 'MIT',
    directory: '.',
  },
  {
    id: 'cangnu',
    repository: 'zzy/cangnu',
    revision: 'b11e07226fd9e56e0d784775dc0a3b9c30871257',
    license: 'MIT',
    directory: '.',
  },
  {
    id: 'mousuo',
    repository: 'zzy/mousuo',
    revision: '9195d424c207600371e1f8e3613ef8037d62ada7',
    license: 'MIT',
    directory: '.',
  },
];
