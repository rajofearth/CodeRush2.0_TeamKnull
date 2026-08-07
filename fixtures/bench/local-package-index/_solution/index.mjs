export class PackageIndex {
  constructor(manifest) {
    this.manifest = manifest;
  }
  resolve(name, version) {
    const pkg = this.manifest[name];
    if (!pkg) return null;
    const path = pkg.versions[version];
    return path ?? null;
  }
}
