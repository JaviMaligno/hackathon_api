import { Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';

@Injectable()
export class PlayerService {
  constructor(private readonly prismaService: PrismaService) {}

  async listAllPlayers() {
    return await this.prismaService.player.findMany({
      select: {
        id: true,
        name: true,
        height: true,
        weigth: true,
        events: {
          select: {
            type: true,
            match: {
              select: {
                date: true,
              },
            },
          },
        },
        playerStats: {
          select: {
            walking: true,
            jogging: true,
            running: true,
            high_speed_running: true,
            sprinting: true,
            distance: true,
            average_speed: true,
            max_speed: true,
            minute_from: true,
            minute_to: true,
            match: {
              select: {
                opponent: true,
                date: true,
              },
            },
          },
        },
        observations: true,
      },
    });
  }

  async findPlayerById(id: number) {
    return await this.prismaService.player.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        height: true,
        weigth: true,
        observations: true,
        createdAt: true,
        updatedAt: true,
        playerStats: {
          select: {
            walking: true,
            jogging: true,
            running: true,
            high_speed_running: true,
            sprinting: true,
            match: {
              select: {
                opponent: true,
                date: true,
              },
            },
          },
        },
      },
    });
  }
}
