/* eslint-disable @typescript-eslint/explicit-member-accessibility,new-cap */

// eslint-disable-next-line matrix-org/require-copyright-header
// import {IsNumber, IsOptional, IsString} from "class-validator";
//
// export class MapPinDto {
//     @IsNumber()
//     id!: number;
//
//     @IsNumber()
//     room_id!: number
//
//     @IsString({})
//     name!: string
//
//     @IsString()
//     type!: string
//
//     @IsNumber()
//     longitude!: number
//
//     @IsNumber()
//     latitude!: number
//
//     @IsNumber()
//     @IsOptional()
//     altitude?: number
//
//     @IsNumber()
//     @IsOptional()
//     bearing?: number
//
//     @IsNumber()
//     @IsOptional()
//     speed?: number
//
//     @IsNumber()
//     @IsOptional()
//     accuracy?: number
//
//     @IsNumber()
//     @IsOptional()
//     hdop?: number
//
//     @IsNumber()
//     @IsOptional()
//     batt?: number
//
//     @IsNumber()
//     @IsOptional()
//     updatedAt?: number
// }

// eslint-disable-next-line matrix-org/require-copyright-header
export interface MapPinDto {
    id: number;
    room_id: string
    name: string
    type: string
    longitude: number
    latitude: number
    altitude?: number
    bearing?: number
    speed?: number
    accuracy?: number
    hdop?: number
    batt?: number
    updatedAt?: number
}
