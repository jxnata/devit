import type { Command } from "../framework.ts";
import { askCommand } from "./ask.ts";
import { doctorCommand } from "./doctor.ts";
import { githubCommands } from "./github.ts";
import { memoryCommands } from "./memory.ts";
import { personaCommands } from "./persona.ts";
import { playbookCommands } from "./playbook.ts";
import { projectCommands } from "./project.ts";
import { routineCommands } from "./routine.ts";
import { runCommands } from "./run.ts";
import { serveCommand } from "./serve.ts";
import { skillCommands } from "./skill.ts";
import { taskCommands } from "./task.ts";

export const commands: Command[] = [
  ...projectCommands,
  ...taskCommands,
  ...personaCommands,
  ...playbookCommands,
  ...runCommands,
  askCommand,
  ...routineCommands,
  serveCommand,
  ...githubCommands,
  ...skillCommands,
  ...memoryCommands,
  doctorCommand,
];
