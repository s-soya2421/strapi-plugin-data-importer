export default ({ strapi }: { strapi: any }) => ({
  async getMappings(ctx: any) {
    const service = strapi.plugin('data-importer').service('import');
    const mappings = await service.getMappings();
    ctx.body = { data: mappings };
  },

  async getContentTypes(ctx: any) {
    const service = strapi.plugin('data-importer').service('import');
    const contentTypes = await service.getContentTypes();
    ctx.body = { data: contentTypes };
  },

  async importRecords(ctx: any) {
    const { uid, rows, fieldMapping, dryRun = false, batchOffset = 0 } = ctx.request.body;

    if (!uid || !Array.isArray(rows) || !fieldMapping) {
      return ctx.badRequest('uid, rows, and fieldMapping are required');
    }

    const service = strapi.plugin('data-importer').service('import');
    const result = await service.importRecords(uid, rows, fieldMapping, dryRun, batchOffset);
    ctx.body = { data: result };
  },
});
