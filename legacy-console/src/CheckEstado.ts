import * as fs from "fs";
import * as path from "path";

interface CourseData {
  course: string;
  current: { module: string; competency: string };
  modules: Module[];
}

interface Module {
  title: string;
  completed: boolean;
  competencies: { title: string; completed: boolean }[];
  projects: { title: string; completed: boolean }[];
}

function countAllCompleted(obj: unknown): { trues: number; falses: number } {
  let trues = 0;
  let falses = 0;

  function walk(value: unknown): void {
    if (value === null || value === undefined) return;

    if (typeof value === "boolean") {
      if (value) trues++;
      else falses++;
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }

    if (typeof value === "object") {
      for (const val of Object.values(value as Record<string, unknown>)) {
        walk(val);
      }
      return;
    }
  }

  walk(obj);
  return { trues, falses };
}

// Read and parse the JSON file
const filePath = path.resolve(__dirname, "..", "ESTADO_CURSO.json");
const rawData = fs.readFileSync(filePath, "utf-8");
const courseData: CourseData = JSON.parse(rawData);

const { trues, falses } = countAllCompleted(courseData);
const total = trues + falses;
const percentage = total > 0 ? (trues / total) * 100 : 0;

console.log("=======================");
console.log(` Curso: ${courseData.course}`);
console.log(` Módulo actual: ${courseData.current.module}`);
console.log("=======================");
console.log(` Total "completed: true":  ${trues}`);
console.log(` Total "completed: false": ${falses}`);
console.log(` Total elementos:          ${total}`);
console.log("-----------------------");
console.log(` Progreso completado: ${percentage.toFixed(2)}%`);
console.log("=======================");
