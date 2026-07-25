export type Point = { x: number; y: number };
export type Wall = { a: Point; b: Point };
export type Room = { name: string; center: Point };
export const rooms: Room[] = [
  { name: 'Cafeteria', center: { x: 100, y: 100 } },
  { name: 'Reactor', center: { x: 300, y: 100 } },
  { name: 'Electrical', center: { x: 300, y: 300 } },
  { name: 'MedBay', center: { x: 100, y: 300 } },
];
export const walls: Wall[] = [
  { a: { x: 0, y: 0 }, b: { x: 400, y: 0 } },
];
export function roomAt(x: number, y: number): string {
  for (const r of rooms) {
    if (Math.abs(x - r.center.x) < 80 && Math.abs(y - r.center.y) < 80) return r.name;
  }
  return 'Unknown';
}
