export class UserDirectory {
  constructor(users) {
    this.users = users;
  }
  findById(id) {
    return this.users.find((u) => u.id === id);
  }
}
