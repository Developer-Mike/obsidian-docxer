import { Plugin } from "obsidian";

export function registerCommands(plugin: Plugin) {
  plugin.addCommand({
    id: "import-docx",
    name: "Import .docx file",
    callback: importDocx
  });
}

function importDocx() {
  console.log("Hey, you!");
}