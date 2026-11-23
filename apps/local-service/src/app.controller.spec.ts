import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseService } from './database/database.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: DatabaseService,
          useValue: {
            getDatabase: () => ({
              prepare: () => ({ get: () => ({ result: 1 }) }),
            }),
          },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  it('returns the service name', () => {
    expect(appController.getHello()).toBe(
      'TUKAKA Database Studio Local Service',
    );
  });

  it('reports health', () => {
    expect(appController.getHealth()).toMatchObject({
      status: 'ok',
      database: 'connected',
    });
  });
});
