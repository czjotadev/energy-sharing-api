import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateEnergyCalculationDto } from './dto/create-energy-calculation.dto';
import { UpdateEnergyCalculationDto } from './dto/update-energy-calculation.dto';
import { PrismaService } from 'src/configurations/prisma/prisma.service';
import { RateInterface } from '../rates/interfaces/rate.interface';
import { FlagInterface } from '../flags/interfaces/flag.interface';

/*

#REGRAS DE NEGÓCIO:

  1. TAXAS:
    1.1 TAXAS DO TIPO FIXED (FIXAS) SERÃO SOMADAS AO VALOR TOTAL DA CONTA
    1.2 TAXAS DO TIPO CONSUMPTION (CONSUMO) SERÃO MULTIPLICADAS PELO CONSUMO INFORMADO
    1.3 TAXAS DO TIPO TAXATION (IMPOSTOS) SERÃO PERCENTUAIS BASEADOS NO CONSUMO
  
  2. BANDEIRAS:
    1. TAXA DE CONSUMO TERÁ UM VALOR ADICIONAL AO CONSUMO EXCEDENTE

*/

@Injectable()
export class EnergyCalculationsService {

  constructor(private prismaService: PrismaService) { }

  async create(createEnergyCalculationDto: CreateEnergyCalculationDto) {
    try {

      const { houseId, flagId, date, consumption } = createEnergyCalculationDto;

      const rates = await this.prismaService.rate.findMany({
        where: {
          active: true,
          deletedAt: null
        }
      })

      const flag = await this.prismaService.flag.findFirstOrThrow({
        where: {
          id: flagId,
          active: true,
          deletedAt: null
        }
      })

      const energyCalculation = await this.prismaService.energyCalculation.create({
        data: {
          houseId,
          flagId,
          date,
          consumption,
        }
      })

      const value = await this.calculateRates(rates, flag, consumption, energyCalculation.id)

      const updatedEnergyCalculation = await this.prismaService.energyCalculation.update({
        where: {
          id: energyCalculation.id,
        },
        data: {
          value
        },
        select: {
          id: true,
          value: true,
          flag: true,
          house: true,
          EnergyCalculationFlag: {
            select: {
              id: true,
              value: true,
              flag: true
            }
          },
          EnergyCalculationRate: {
            select: {
              id: true,
              value: true,
              description: true,
              rate: true
            }
          },
        }
      })

      return { message: 'Calculo gerado com sucesso.', data: updatedEnergyCalculation }

    } catch (error) {
      if (error instanceof HttpException) {
        throw new HttpException(error.message, error.getStatus())
      }
      throw new HttpException(`Erro ao realizar cadastro`, HttpStatus.INTERNAL_SERVER_ERROR)
    }
  }

  findAll() {
    return `This action returns all energyCalculations`;
  }

  findOne(id: number) {
    return `This action returns a #${id} energyCalculation`;
  }

  update(id: number, updateEnergyCalculationDto: UpdateEnergyCalculationDto) {
    return `This action updates a #${id} energyCalculation`;
  }

  remove(id: number) {
    return `This action removes a #${id} energyCalculation`;
  }

  private async calculateRates(rates: RateInterface[], flag: FlagInterface, consumption: number, energyCalculationId: number) {

    let fixedValue = 0;
    let consumptionValue = 0
    let totalValue = 0;
    const taxationPercents: { rateId: number, value: number }[] = [];
    const additionalValues = this.calculateFlag(flag, consumption)

    for (const rate of rates) {
      if (rate.type === 'FIXED') {
        await this.prismaService.energyCalculationRate.create({
          data: {
            energyCalculationId,
            rateId: rate.id,
            value: rate.value
          }
        });

        fixedValue += rate.value;

      } else if (rate.type === 'CONSUMPTION') {
        if (additionalValues.consumption > 0) {
          const defaultConsumption = consumption - additionalValues.consumption;
          const additionalConsumption = additionalValues.consumption;
          const additionalConsumptionValue = additionalValues.value;

          await this.prismaService.energyCalculationRate.create({
            data: {
              energyCalculationId,
              rateId: rate.id,
              value: rate.value * defaultConsumption,
              description: 'CONSUMO COM TARIFA BASE'
            }
          });

          consumptionValue += rate.value * defaultConsumption;

          await this.prismaService.energyCalculationRate.create({
            data: {
              energyCalculationId,
              rateId: rate.id,
              value: (rate.value + additionalConsumptionValue) * additionalConsumption,
              description: `CONSUMO COM TARIFA ADICIONAL DE R$ ${additionalConsumptionValue} POR KW/H `
            }
          });

          consumptionValue += (rate.value + additionalConsumptionValue) * additionalConsumption;

        } else {
          await this.prismaService.energyCalculationRate.create({
            data: {
              energyCalculationId,
              rateId: rate.id,
              value: rate.value * consumption
            }
          });

          consumptionValue += rate.value * consumption;
        }

      } else if (rate.type === 'TAXATION') {
        taxationPercents.push({ value: rate.value, rateId: rate.id });
      }
    }

    for (const taxationPercent of taxationPercents) {

      await this.prismaService.energyCalculationRate.create({
        data: {
          energyCalculationId,
          rateId: taxationPercent.rateId,
          value: consumptionValue * (taxationPercent.value / 100)
        }
      })

      totalValue = + consumptionValue * (taxationPercent.value / 100)
    }

    totalValue = + (fixedValue + consumptionValue)

    return totalValue

  }

  private calculateFlag(flag: FlagInterface, consumption: number) {

    const additionalValue = {
      consumption: 0,
      value: 0
    }

    const value = consumption - flag.consumptionReference

    if (value > 0) {
      additionalValue.consumption = value
      additionalValue.value = flag.additionalValue
    }

    return additionalValue;
  }
}
