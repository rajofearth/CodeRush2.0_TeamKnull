export function sanitizeHtml(html) {
  let out = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  out = out.replace(/\son[a-z]+\s*=\s*(['"])[^'"]*\1/gi, "");
  out = out.replace(/\shref\s*=\s*(['"])javascript:[^'"]*\1/gi, "");
  return out;
}
