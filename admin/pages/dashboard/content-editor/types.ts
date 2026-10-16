import type { ReactNode } from 'react';

/**
 * The shared shapes of the content editor (ContentEditor.tsx). Every page of
 * «صفحات الموقع» describes itself as sections of fields; the editor draws them,
 * tracks what changed and saves the whole page in one setContentValues call.
 */

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  /** Stores 'true' / 'false'. */
  | 'toggle'
  | 'select'
  /** A YouTube / youtu.be / shorts link, checked and previewed. */
  | 'youtube'
  | 'url'
  /** A URL of a picture, previewed. */
  | 'image';

export type FieldOption = { value: string; label: string };

export interface EditorField {
  key: string;
  label: string;
  /** Older field lists say multiline instead of type: 'textarea'. */
  multiline?: boolean;
  type?: FieldType;
  /** One line under the field: what it changes on the site. */
  hint?: string;
  /** What the site shows while the field is empty. Falls back to the known site default. */
  placeholder?: string;
  options?: FieldOption[];
  /** toggle: what an empty value means on the site. */
  defaultOn?: boolean;
  onLabel?: string;
  offLabel?: string;
  /** Which section of a sectioned page the field belongs to. */
  section?: string;
  /** Take the full width of the section's grid. */
  wide?: boolean;
  min?: number;
  max?: number;
}

/** What a section's own content (a picker, a preview) can read and write. */
export interface EditorApi {
  /** The value on screen: the unsaved edit, else what is saved. */
  value: (key: string) => string;
  set: (key: string, value: string) => void;
  isDirty: (key: string) => boolean;
}

export type SectionSlot = ReactNode | ((api: EditorApi) => ReactNode);

export interface EditorSection {
  id: string;
  title: string;
  /** One line under the title: where this is on the site. */
  hint?: string;
  icon?: ReactNode;
  fields: EditorField[];
  /** Drawn above the fields. */
  before?: SectionSlot;
  /** Drawn below the fields. */
  after?: SectionSlot;
  /** Keys written by `before` / `after` rather than by a field, so they are saved with the page. */
  keys?: string[];
  /** Extra words the search box finds this section by. */
  keywords?: string;
}

export type NotifyFn = (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;

export const fieldType = (field: EditorField): FieldType =>
  field.type || (field.multiline ? 'textarea' : 'text');
