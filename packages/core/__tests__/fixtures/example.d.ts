
declare module "example" {
  export function greet(name: string): string;
  export interface User {
    id: number;
    name: string;
  }
  export class Calculator {
    add(a: number, b: number): number;
    multiply(a: number, b: number): number;
  }
  export type ID = number | string;
  export const VERSION: string;
}
