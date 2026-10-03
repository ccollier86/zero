/** Named write-command registry contributed to each Data Studio tenant realm. */

import { DATA_STUDIO_COMMAND_NAMES } from './data-studio-operation-contracts';
import {
  createDataStudioRowCommand,
  deleteDataStudioRowCommand,
  replaceDataStudioRowCommand,
} from './data-studio-row-commands';
import {
  createDataStudioTableCommand,
  setDataStudioTableStatusCommand,
  updateDataStudioTableCommand,
} from './data-studio-table-commands';

export const DATA_STUDIO_REALM_COMMANDS = Object.freeze({
  [DATA_STUDIO_COMMAND_NAMES.createTable]: createDataStudioTableCommand,
  [DATA_STUDIO_COMMAND_NAMES.updateTable]: updateDataStudioTableCommand,
  [DATA_STUDIO_COMMAND_NAMES.setTableStatus]: setDataStudioTableStatusCommand,
  [DATA_STUDIO_COMMAND_NAMES.createRow]: createDataStudioRowCommand,
  [DATA_STUDIO_COMMAND_NAMES.replaceRow]: replaceDataStudioRowCommand,
  [DATA_STUDIO_COMMAND_NAMES.deleteRow]: deleteDataStudioRowCommand,
});

