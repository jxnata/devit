import type { Command } from "../framework.ts";
import { doctorCommand } from "./doctor.ts";
import { projectCommands } from "./project.ts";
import { taskCommands } from "./task.ts";

export const commands: Command[] = [...projectCommands, ...taskCommands, doctorCommand];
