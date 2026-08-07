export class UserDirectory {
  constructor(users) {
    this.users = users;
    this._byId = new Map(users.map((u) => [u.id, u]));
  }
  findById(id) {
    return this._byId.get(id);
  }
}
