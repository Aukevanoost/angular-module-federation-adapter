import * as fs from 'fs';
import * as path from 'path';
import * as mrmime from 'mrmime';

export interface StaticRequest {
  url?: string;
}

export interface StaticResponse {
  writeHead: (status: number, headers: Record<string, string>) => void;
  end: (body: string) => void;
}

export type StaticMiddleware = (
  req: StaticRequest,
  res: StaticResponse,
  next: () => void
) => void;

export function createStaticFileMiddleware(rootDir: string): StaticMiddleware {
  return (req, res, next) => {
    const url = req.url ?? '';
    const isRoot = url === '/' || url === '';
    const relPath = isRoot ? 'index.html' : url;
    const fileName = path.join(rootDir, relPath);

    if (!fs.existsSync(fileName) || !fs.statSync(fileName).isFile()) {
      next();
      return;
    }

    const mimeType = mrmime.lookup(path.extname(fileName)) || 'text/javascript';
    const rawBody = fs.readFileSync(fileName, 'utf-8');

    res.writeHead(200, {
      'Content-Type': mimeType,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end(rawBody);
  };
}
