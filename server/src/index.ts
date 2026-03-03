import controllers from './controllers';
import routes from './routes';
import services from './services';

export default {
  register({ strapi }: { strapi: any }) {},
  bootstrap({ strapi }: { strapi: any }) {},
  controllers,
  routes,
  services,
};
