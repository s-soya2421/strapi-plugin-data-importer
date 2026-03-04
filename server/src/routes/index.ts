export default {
  admin: {
    type: 'admin',
    routes: [
      {
        method: 'GET',
        path: '/mappings',
        handler: 'import.getMappings',
        config: { policies: [] },
      },
      {
        method: 'GET',
        path: '/content-types',
        handler: 'import.getContentTypes',
        config: { policies: [] },
      },
      {
        method: 'GET',
        path: '/history',
        handler: 'import.getHistory',
        config: { policies: [] },
      },
      {
        method: 'POST',
        path: '/import',
        handler: 'import.importRecords',
        config: { policies: [] },
      },
    ],
  },
};
