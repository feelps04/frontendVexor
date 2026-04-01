declare module 'oracledb' {
  export default any;
}

declare module 'pdfkit' {
  class PDFDocument {
    constructor(options?: any);
    pipe(destination: any): this;
    end(): void;
    fontSize(size: number): this;
    text(text: string, options?: any): this;
  }
  export = PDFDocument;
}

declare module 'ffi-napi' {
  const Library: any;
  export = Library;
}

declare module 'ref-napi' {
  export function alloc(type: any, size?: number): any;
  export function readPointer(buffer: any, offset: number, length: number): Buffer;
  export function writePointer(buffer: any, offset: number, data: Buffer): void;
}

declare module 'ref-struct-napi' {
  export default function Struct(layout: any): any;
}
