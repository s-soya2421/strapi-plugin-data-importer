import { PLUGIN_ID } from './pluginId';
import PluginIcon from './components/PluginIcon';

const PERMISSIONS = {
  read: [{ action: `plugin::${PLUGIN_ID}.read`, subject: null }],
};

const prefixTranslations = (data: Record<string, string>) =>
  Object.keys(data).reduce((acc, key) => {
    acc[`${PLUGIN_ID}.${key}`] = data[key];
    return acc;
  }, {} as Record<string, string>);

export default {
  register(app: any) {
    app.addMenuLink({
      to: `/plugins/${PLUGIN_ID}`,
      icon: PluginIcon,
      permissions: PERMISSIONS.read,
      intlLabel: {
        id: `${PLUGIN_ID}.plugin.name`,
        defaultMessage: 'Data Importer',
      },
      Component: async () => {
        const { default: HomePage } = await import('./pages/HomePage');
        return HomePage;
      },
    });

    app.registerPlugin({
      id: PLUGIN_ID,
      name: PLUGIN_ID,
    });
  },
  bootstrap() {},
  async registerTrads({ locales }: { locales: string[] }) {
    const importedTrads = await Promise.all(
      locales.map(async (locale) => {
        try {
          const { default: data } = await import(`./translations/${locale}.json`);
          return { data: prefixTranslations(data), locale };
        } catch {
          return { data: {}, locale };
        }
      })
    );
    return importedTrads;
  },
};
