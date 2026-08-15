import { SqlExecutor } from '../sql/SqlDriver.js';
import { Person } from '@face/core';

export class PersonRepository {
  constructor(private adapter: SqlExecutor) {}

  public async savePerson(person: Person): Promise<void> {
    const existing = await this.getPersonById(person.id);
    if (existing) {
      this.adapter.run(
        `UPDATE persons SET employee_code = ?, display_name = ?, status = ?, updated_at = ? WHERE id = ?`,
        [person.employeeCode || null, person.displayName, person.status, person.updatedAt, person.id]
      );
    } else {
      this.adapter.run(
        `INSERT INTO persons (id, employee_code, display_name, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [person.id, person.employeeCode || null, person.displayName, person.status, person.createdAt, person.updatedAt]
      );
    }
  }

  public async getPersonById(id: string): Promise<Person | null> {
    const rows = this.adapter.exec(`SELECT id, employee_code, display_name, status, created_at, updated_at FROM persons WHERE id = ?`, [id]);
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id as string,
      employeeCode: (r.employee_code as string) || undefined,
      displayName: r.display_name as string,
      status: r.status as 'ACTIVE' | 'INACTIVE' | 'ARCHIVED',
      createdAt: r.created_at as number,
      updatedAt: r.updated_at as number,
    };
  }

  public async listActivePersons(): Promise<Person[]> {
    const rows = this.adapter.exec(`SELECT id, employee_code, display_name, status, created_at, updated_at FROM persons WHERE status = 'ACTIVE'`);
    return rows.map((r) => ({
      id: r.id as string,
      employeeCode: (r.employee_code as string) || undefined,
      displayName: r.display_name as string,
      status: r.status as 'ACTIVE' | 'INACTIVE' | 'ARCHIVED',
      createdAt: r.created_at as number,
      updatedAt: r.updated_at as number,
    }));
  }
}
