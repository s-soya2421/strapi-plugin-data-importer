const READ_PERMISSION_POLICY = {
  name: 'admin::hasPermissions',
  config: {
    actions: ['plugin::data-importer.read'],
  },
};

const IMPORT_PERMISSION_POLICY = {
  name: 'admin::hasPermissions',
  config: {
    actions: ['plugin::data-importer.import'],
  },
};

export default {
  admin: {
    type: 'admin',
    routes: [
      {
        method: 'GET',
        path: '/mappings',
        handler: 'import.getMappings',
        config: { policies: [READ_PERMISSION_POLICY] },
      },
      {
        method: 'GET',
        path: '/content-types',
        handler: 'import.getContentTypes',
        config: { policies: [READ_PERMISSION_POLICY] },
      },
      {
        method: 'GET',
        path: '/history',
        handler: 'import.getHistory',
        config: { policies: [READ_PERMISSION_POLICY] },
      },
      {
        method: 'POST',
        path: '/import',
        handler: 'import.importRecords',
        config: { policies: [IMPORT_PERMISSION_POLICY] },
      },
    ],
  },
};
