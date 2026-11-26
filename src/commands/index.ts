import type { Command } from "../framework.ts";
import { doctorCommand } from "./doctor.ts";
import { memoryCommands } from "./memory.ts";
import { personaCommands } from "./persona.ts";
import { projectCommands } from "./project.ts";
import { runCommands } from "./run.ts";
import { taskCommands } from "./task.ts";

export const commands: Command[] = [
  ...projectCommands,
  ...taskCommands,
  ...personaCommands,
  ...runCommands,
  ...memoryCommands,
  doctorCommand,
];
