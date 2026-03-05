import controllers from './controllers';
import routes from './routes';
import services from './services';

const ACTIONS = [
  {
    section: 'plugins',
    displayName: 'Read',
    uid: 'read',
    pluginName: 'data-importer',
  },
  {
    section: 'plugins',
    displayName: 'Import',
    uid: 'import',
    pluginName: 'data-importer',
  },
];

export default {
  async register({ strapi }: { strapi: any }) {
    const actionProvider = strapi.admin?.services?.permission?.actionProvider;
    if (actionProvider?.registerMany) {
      await actionProvider.registerMany(ACTIONS);
    }
  },
  bootstrap({ strapi }: { strapi: any }) {},
  controllers,
  routes,
  services,
};
