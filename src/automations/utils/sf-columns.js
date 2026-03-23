'use strict';

/**
 * Screaming Frog column name aliases → canonical names.
 *
 * Different SF export versions / configurations may name the same column
 * slightly differently.  This map lets analysis code reference a canonical
 * key and resolve it against whichever header name the CSV actually contains.
 */

const COLUMN_ALIASES = {
  ADDRESS:         ['Address', 'address', 'URL', 'url'],
  TITLE:           ['Title 1', 'Page Title'],
  TITLE_LENGTH:    ['Title 1 Length', 'Page Title Length'],
  META_DESC:       ['Meta Description 1'],
  META_DESC_LENGTH:['Meta Description 1 Length'],
  H1_1:            ['H1-1'],
  H1_1_LENGTH:     ['H1-1 Length'],
  H1_2:            ['H1-2'],
  H1_2_LENGTH:     ['H1-2 Length'],
  H2_1:            ['H2-1'],
  H2_1_LENGTH:     ['H2-1 Length'],
  STATUS_CODE:     ['Status Code', 'Status'],
  INDEXABILITY:    ['Indexability'],
  CONTENT_TYPE:    ['Content Type'],
  ALT_TEXT:        ['Alt Text'],
  ALT_TEXT_LENGTH: ['Alt Text Length'],
  IMAGE_DEST:      ['Destination', 'Destination URL'],
  IMAGE_SOURCE:    ['Source', 'Source URL'],
};

/**
 * Look up a column value in a row using a canonical column name.
 *
 * Tries each alias in order and returns the first match found.  Returns an
 * empty string when no alias matches a key in the row.
 *
 * @param {object} row            A parsed CSV row object
 * @param {string} canonicalName  Key from COLUMN_ALIASES (e.g. 'TITLE')
 * @returns {string}
 */
function getColumn(row, canonicalName) {
  const aliases = COLUMN_ALIASES[canonicalName];
  if (!aliases) return '';
  for (const alias of aliases) {
    if (row[alias] !== undefined && row[alias] !== null) return row[alias];
  }
  return '';
}

module.exports = { COLUMN_ALIASES, getColumn };
