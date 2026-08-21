import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';

@Controller()
export class AppController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Real health, not a constant. A server that answers ONLINE while the
   * database is unreachable is worse than one that answers honestly - the
   * caller has no way to tell the difference between "fine" and "silently
   * broken" until a write fails.
   */
  @Get('health')
  async health() {
    const databaseUp = this.dataSource.isInitialized
      ? await this.dataSource.query('SELECT 1').then(
          () => true,
          () => false,
        )
      : false;

    return {
      status: databaseUp ? 'ONLINE' : 'DEGRADED',
      database: databaseUp,
      appName: this.configService.get<string>('app.appName'),
      checkedAt: new Date().toISOString(),
    };
  }
}
