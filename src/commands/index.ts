import type { Command } from "../framework.ts";
import { askCommand } from "./ask.ts";
import { doctorCommand } from "./doctor.ts";
import { memoryCommands } from "./memory.ts";
import { personaCommands } from "./persona.ts";
import { projectCommands } from "./project.ts";
import { routineCommands } from "./routine.ts";
import { runCommands } from "./run.ts";
import { serveCommand } from "./serve.ts";
import { taskCommands } from "./task.ts";

export const commands: Command[] = [
  ...projectCommands,
  ...taskCommands,
  ...personaCommands,
  ...runCommands,
  askCommand,
  ...routineCommands,
  serveCommand,
  ...memoryCommands,
  doctorCommand,
];
