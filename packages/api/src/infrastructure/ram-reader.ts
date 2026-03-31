export const mmfCache: any = {};

export class RAMReader {
  private connected = false;
  
  async connect(): Promise<boolean> {
    this.connected = false;
    return false;
  }

  startPolling(_intervalMs: number): void {}

  getData(): any {
    return { global_connected: false, global_symbols: [], b3_connected: false, b3_symbols: [] };
  }
}

export const globalRAMReader = new RAMReader();
export const b3RAMReader = new RAMReader();
