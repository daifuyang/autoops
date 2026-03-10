module.exports = {
  'autoops-api': {
    input: {
      target: 'http://localhost:3000/api/docs/json',
      override: {
        transformer: './orval.openapi-transformer.cjs',
      },
    },
    output: {
      target: './generated',
      client: 'axios',
      schemas: false,
      mock: false,
      override: {
        useNamedParameters: true,
        mutator: {
          path: './lib/axios-instance.ts',
          name: 'customInstance',
        },
      },
    },
  },
};
