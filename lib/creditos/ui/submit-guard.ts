/**
 * Candado síncrono contra doble envío (setState de busy es asíncrono).
 */
export function createSubmitGuard() {
  let locked = false;
  return {
    tryAcquire(): boolean {
      if (locked) return false;
      locked = true;
      return true;
    },
    release(): void {
      locked = false;
    },
  };
}
