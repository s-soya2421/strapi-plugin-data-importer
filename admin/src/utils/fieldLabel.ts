import type { FieldInfo } from '../types';

export const getFieldLabel = (f: FieldInfo): string => {
  let label: string;
  if (f.type === 'relation' && f.relationType) {
    label = `${f.name} (relation: ${f.relationType})`;
  } else if (f.type === 'media') {
    label = `${f.name} (media: ${f.multiple ? 'multiple IDs' : 'single ID'})`;
  } else {
    label = `${f.name} (${f.type})`;
  }
  if (f.required) label += ' *';
  return label;
};
