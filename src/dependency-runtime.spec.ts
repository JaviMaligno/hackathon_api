import 'reflect-metadata';
import * as net from 'node:net';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TeamController } from './team/team.controller';
import { TeamService } from './team/team.service';
import { PlayerController } from './player/player.controller';
import { PlayerService } from './player/player.service';
import { FormationController } from './formation/formation.controller';
import { FormationService } from './formation/formation.service';

describe('Nest dependency compatibility without bootstrap or database', () => {
  let module: TestingModule;
  let connectionGuard: jest.SpyInstance;
  const teams = {
    listAll: jest.fn(async () => [{ id: 7 }]),
    deleteAll: jest.fn(async () => ({ count: 0 })),
    setAbrv: jest.fn(async () => ({ id: 7, abrv: 'FIX' })),
  };
  const players = {
    listAllPlayers: jest.fn(async () => [{ id: 11 }]),
    findPlayerById: jest.fn(async () => ({ id: 11 })),
    submitObservations: jest.fn(async () => ({ id: 11, available: false })),
  };
  const formations = { listAll: jest.fn(async () => [{ name: 'synthetic' }]) };

  beforeAll(async () => {
    connectionGuard = jest
      .spyOn(net.Socket.prototype, 'connect')
      .mockImplementation(() => {
        throw new Error('Offline controller contract attempted TCP');
      });
    module = await Test.createTestingModule({
      controllers: [
        AppController,
        TeamController,
        PlayerController,
        FormationController,
      ],
      providers: [
        AppService,
        { provide: TeamService, useValue: teams },
        { provide: PlayerService, useValue: players },
        { provide: FormationService, useValue: formations },
      ],
    }).compile();
  });
  afterAll(async () => {
    await module?.close();
    connectionGuard.mockRestore();
  });

  it('preserves actual health controller response and route metadata', () => {
    expect(module.get(AppController).getHello()).toEqual({
      message: 'connected',
    });
    expect(Reflect.getMetadata(PATH_METADATA, TeamController)).toBe('team');
    expect(Reflect.getMetadata(PATH_METADATA, PlayerController)).toBe('player');
    expect(
      Reflect.getMetadata(METHOD_METADATA, TeamController.prototype.setAbrv),
    ).toBe(RequestMethod.PUT);
    expect(
      Reflect.getMetadata(PATH_METADATA, PlayerController.prototype.findOne),
    ).toBe(':id');
  });
  it('injects team service and preserves numeric route parameter conversion', async () => {
    const controller = module.get(TeamController);
    await expect(controller.listAll()).resolves.toEqual([{ id: 7 }]);
    await expect(
      controller.setAbrv({ id: '7' } as unknown as { id: number }, {
        abrv: 'FIX',
      }),
    ).resolves.toEqual({ id: 7, abrv: 'FIX' });
    expect(teams.setAbrv).toHaveBeenCalledWith(7, 'FIX');
  });
  it('preserves player payload fields and formation response', async () => {
    const controller = module.get(PlayerController);
    await expect(controller.findOne({ id: '11' })).resolves.toEqual({ id: 11 });
    await controller.submitObservation(
      { id: '11' },
      { observations: 'synthetic', available: false, position: 'GK' },
    );
    expect(players.submitObservations).toHaveBeenCalledWith(
      11,
      'synthetic',
      false,
      'GK',
    );
    await expect(module.get(FormationController).listAll()).resolves.toEqual([
      { name: 'synthetic' },
    ]);
  });
});
