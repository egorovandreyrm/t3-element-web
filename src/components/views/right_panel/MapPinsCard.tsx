import React, {useCallback, useEffect, useRef, useState} from "react";
import * as maplibregl from "maplibre-gl";
import axios from "axios";

import type {Room} from "matrix-js-sdk/src/matrix.ts";
import BaseCard from "./BaseCard.tsx";
import {MapPinDto} from "./map-pin.dto.ts";
import {Button} from "@vector-im/compound-web";
import {RestartIcon} from "@vector-im/compound-design-tokens/assets/web/icons";
import {FeatureCollection} from "geojson";
import {Icon as PlusIcon} from "@vector-im/compound-design-tokens/icons/plus.svg";
import {Icon as CheckIcon} from "@vector-im/compound-design-tokens/icons/check.svg";
import Modal from "../../../Modal.tsx";
import MapPinCreateDialog from "../elements/MapPinCreateDialog.tsx";


interface IProps {
    room: Room;
}

const DEFAULT_LAT = 25.197081 // 44.601498
const DEFAULT_LON = 55.277288 // 33.460187

const MAP_STYLES_URL = `https://api.maptiler.com/maps/streets/style.json?key=ZLq0uqItQ7rcHxmxaCUW`
const MAP_PINS_API_URL = `http://t3.rpipro.xyz:5055/api/v1/map/pins`;
const MAP_PINS_API_KEY = 'root';

class ApiClientError extends Error {
    public constructor(serviceName: string, message: string) {
        super(`${serviceName} service: error: ${message}`)
    }
}

class ApiClientIoError extends ApiClientError {
    public constructor(serviceName: string, message: string) {
        super(serviceName, message)
    }
}

class ApiClientApiError extends ApiClientError {
    public readonly status: number
    public error: string
    public errorMessage: string

    public constructor(
        serviceName: string,
        status: number,
        error: string,
        errorMessage: string
    ) {
        super(serviceName, `api: ${error}, message: ${errorMessage}, status: ${status}`)

        this.status = status
        this.error = error
        this.errorMessage = errorMessage
    }
}

function handleAxiosError(serviceName: string, e: any): ApiClientError {
    if (e.response) {
        if (e.response.data) {
            const apiError = e.response.data.error as string | undefined
            const apiErrorMessage = e.response.data.message as string | undefined

            if (apiError && apiErrorMessage) {
                return new ApiClientApiError(
                    serviceName,
                    e.response.status,
                    apiError,
                    apiErrorMessage
                )
            } else {
                return new ApiClientApiError(
                    serviceName,
                    e.response.status,
                    JSON.stringify(e.response.data),
                    '-'
                )
            }
        } else {
            return new ApiClientApiError(
                serviceName,
                e.response.status,
                'unknown error',
                '-'
            )
        }
    }

    return new ApiClientIoError(serviceName, e.message)
}

// async function transformAndValidateDtos<T extends object, V>(
//     cls: ClassConstructor<T>, plain: V[]
// ): Promise<T[]> {
//     const obj = plainToInstance(cls, plain)
//     // const validationErrors = await validate(obj)
//     // if (validationErrors.length != 0) {
//     //     throw new Error(`dto validation failed, errors: ${validationErrors}`)
//     // }
//
//     return obj
// }

async function getMapPinDtos(roomId: string): Promise<MapPinDto[]> {
    try {
        const response = await axios.get(MAP_PINS_API_URL, {
            headers: {"authorization": `key=${MAP_PINS_API_KEY}`},
            params: {roomId},
            timeout: 2000
        })
        //const plainDtos = response.data
        //return await transformAndValidateDtos(MapPinDto, plainDtos)
        return response.data
    } catch (ex) {
        throw handleAxiosError('map-pins', ex)
    }
}

async function deleteMapPin(id: number, roomId: string): Promise<void> {
    try {
        await axios.delete(
            `${MAP_PINS_API_URL}/${id}`,
            {
                headers: {"authorization": `key=${MAP_PINS_API_KEY}`},
                params: {roomId},
                timeout: 2000
            }
        )
    } catch (ex) {
        throw handleAxiosError('map-pins', ex)
    }
}

function getOpenGoogleMapsUrl(lat: number, lng: number): string {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
}

function getPopupMessageHtml(dto: MapPinDto): string {
    // const hrefUrl = getOpenGoogleMapsUrl(dto.latitude, dto.longitude)

    return `<div>` +
        `id: ${dto.id}<br>` +
        `room_id: ${dto.room_id}<br>` +
        `name: ${dto.name}<br>` +
        `type: ${dto.type}<br>` +
        `longitude: ${dto.longitude}<br>` +
        `latitude: ${dto.latitude}<br>` +
        `altitude: ${dto.altitude}<br>` +
        `bearing: ${dto.bearing}<br>` +
        `speed: ${dto.speed}<br>` +
        `accuracy: ${dto.accuracy}<br>` +
        `hdop: ${dto.hdop}<br>` +
        `batt: ${dto.batt}<br>` +
        `updatedAt: ${dto.updatedAt}<br>` +
        //`<a href="${hrefUrl}" target="_blank" rel="noopener noreferrer">Open in Google Maps</a><br>` +
        `</div>`
}

const MapPinsCard: React.FC<IProps> = ({room}) => {
    // const onError = (error: Error): void => {
    //     //this.setState({ error });
    // };


    //const geoUri = `geo:${25.197081},${55.277288}`

    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<maplibregl.Map>(null);
    const mapMarkersRef = useRef<maplibregl.Marker[]>([]);
    const addMapPinMarkerRef = useRef<maplibregl.Marker>(null);

    const [addingNewPinMode, setAddingNewPinMode] = useState(false);
    const [reloadMapPinsTrigger, setReloadMapPinsTrigger] = useState(false);

    const reloadMapPins = (): void => {
        setReloadMapPinsTrigger(c => !c)
        return
    }

    // const [dtos, setDtos] = useState<MapPinDto[]>([]);

    useEffect(() => {
        if (mapRef.current) return; // stops map from intializing more than once

        mapRef.current = new maplibregl.Map({
            container: mapContainerRef.current!,
            style: MAP_STYLES_URL,
            center: [DEFAULT_LON, DEFAULT_LAT],
            zoom: 14
        });

        mapRef.current.addControl(new maplibregl.NavigationControl(), 'top-right');
        mapRef.current.addControl(new maplibregl.GeolocateControl({showUserLocation: true}), 'bottom-right');
    }, []);


    useEffect(() => {
        const MAP_PINS_LAYER_NAME = 'map_pins'
        const MAP_PINS_SOURCE_NAME = 'map_pins'

        if (!mapRef.current) return;
        const map = mapRef.current!

        const retryLoadingStyles = async (): Promise<void> => {
            await new Promise(f => setTimeout(f, 2000));
            reloadMapPins()
        }

        if (!map.isStyleLoaded()) {
            retryLoadingStyles()
            return
        }

        if (addingNewPinMode) {
            if (map.getLayer(MAP_PINS_LAYER_NAME)) map.removeLayer(MAP_PINS_LAYER_NAME);
            if (map.getSource(MAP_PINS_SOURCE_NAME)) map.removeSource(MAP_PINS_SOURCE_NAME)

            mapMarkersRef.current?.forEach(it => {
                it.remove()
            })

            const currentCenter = map.getCenter()

            addMapPinMarkerRef.current = new maplibregl.Marker({color: "#0000FF"})
                .setLngLat([currentCenter.lng, currentCenter.lat])
                .setDraggable(true)
                .addTo(map!)

            return
        } else {
            addMapPinMarkerRef.current?.remove()
        }

        getMapPinDtos(room.roomId).then(rawDtos => {
            const dtos = rawDtos.filter(it => it.name && it.longitude && it.latitude )

            if (map.getLayer(MAP_PINS_LAYER_NAME)) map.removeLayer(MAP_PINS_LAYER_NAME);
            if (map.getSource(MAP_PINS_SOURCE_NAME)) map.removeSource(MAP_PINS_SOURCE_NAME)

            const mapPins: FeatureCollection = {
                'type': 'FeatureCollection',
                'features': dtos.map(it => ({
                    'type': 'Feature',
                    'properties': {
                        'name': it.name,
                    },
                    'geometry': {
                        'type': 'Point',
                        'coordinates': [it.longitude, it.latitude]
                    }
                }))
            }

            map.addSource(MAP_PINS_SOURCE_NAME, {
                'type': 'geojson',
                'data': mapPins
            });

            map.addLayer({
                'id': MAP_PINS_LAYER_NAME,
                'type': 'symbol',
                'source': MAP_PINS_SOURCE_NAME,
                'layout': {
                    'text-field': ['get', 'name'],
                    'text-anchor': 'bottom',
                    'text-offset': [0, 1.25],
                    'text-font': ['Arial Unicode MS Regular'],
                }
            })

            mapMarkersRef.current?.forEach(it => {
                it.remove()
            })

            mapMarkersRef.current = dtos.map(dto => {
                const divElement = document.createElement('div');
                divElement.innerHTML = getPopupMessageHtml(dto)

                const openInGoogleMapsMapPinBtn = document.createElement('div');
                openInGoogleMapsMapPinBtn.innerHTML = `<button class="btn btn-success btn-simple text-white" >GOOGLE MAPS</button>`;
                openInGoogleMapsMapPinBtn.style.padding = '7px 7px 0 0'

                const deleteMapPinBtn = document.createElement('div');
                deleteMapPinBtn.innerHTML = `<button class="btn btn-success btn-simple text-white" >DELETE</button>`;
                deleteMapPinBtn.style.padding = '7px 7px 0 0'

                divElement.appendChild(openInGoogleMapsMapPinBtn);
                divElement.appendChild(deleteMapPinBtn);

                deleteMapPinBtn.addEventListener('click', async (e) => {
                    console.log('delete map pin clicked' + dto.name);
                    await deleteMapPin(dto.id, room.roomId)
                    setReloadMapPinsTrigger(c => !c)
                });

                openInGoogleMapsMapPinBtn.addEventListener('click', async (e) => {
                    console.log('open in google maps map pin clicked' + dto.name);
                    const url = getOpenGoogleMapsUrl(dto.latitude, dto.longitude)
                    window.open(url, '_blank', 'noopener,noreferrer')
                });

                const popup = new maplibregl.Popup({offset: 25, closeButton: false})
                    //.setHTML(popupHtml)
                    .setDOMContent(divElement)

                // popup.on("close", () => {
                //     popup.remove()
                // })
                //
                // popup._onClose()

                const marker = new maplibregl.Marker({color: "#FF0000"})
                    .setLngLat([dto.longitude, dto.latitude])
                    .setPopup(popup)
                    .addTo(map!)

                // marker.on("close", () => {
                //     this.highlightLeg(-1)
                //     currentActiveLeg = null
                //     this.focus()
                // })

                return marker
            })
        }).catch(error => {
            console.error(error);
        })
    }, [room, addingNewPinMode, reloadMapPinsTrigger]);

    const reloadMapPinsClick = useCallback(
        (ev: React.MouseEvent) => {
            reloadMapPins()
        },
        [],
    );

    const addMapPinClick = useCallback(
        (ev: React.MouseEvent) => {
            setAddingNewPinMode(true);
        },
        [],
    );

    const saveMapPinClick = useCallback(
        (ev: React.MouseEvent) => {
            const marker = addMapPinMarkerRef.current
            if (marker) {
                const lngLat = marker.getLngLat()

                Modal.createDialog(
                    MapPinCreateDialog,
                    {
                        room: room,
                        longitude: lngLat.lng,
                        latitude: lngLat.lat,
                        onFinished: (mapPinCreated?: boolean) => {
                            if (mapPinCreated) {
                                setAddingNewPinMode(false);
                                reloadMapPins()
                            }
                        }
                    },
                    "mx_CompoundDialog",
                    false, // isPriorityModal
                    true, // isStaticModal
                );
            }
        },
        [room],
    );

    const header = (
        //<div className={"btn-group"} style="display: flex; flex-direction:column">
        <div style={{display: 'flex'}}>
            {/*{_t("map_pin|right_panel|header_title")}*/}

            {/*<IconButton*/}
            {/*    disabled={false}*/}
            {/*    aria-label={_t("map_pins|right_panel|reload_button")}*/}
            {/*    onClick={reloadMapPinsClick}*/}
            {/*>*/}
            {/*    <RestartIcon/>*/}
            {/*</IconButton>*/}

            {!addingNewPinMode && (
                <Button
                    size="sm"
                    onClick={reloadMapPinsClick}
                    Icon={RestartIcon}
                    // className="mx_RoomHeader_join_button"
                    color="primary"
                >
                    Reload
                </Button>
            )}

            <Button
                size="sm"
                onClick={addingNewPinMode ? saveMapPinClick : addMapPinClick}
                Icon={addingNewPinMode ? CheckIcon : PlusIcon}
                // className="mx_RoomHeader_join_button"
                color="primary"
            >
                {addingNewPinMode ? "Save" : "Add"}
            </Button>

        </div>
    )

    // {_t("map_pins|right_panel|reload_button")}


    return (
        <BaseCard
            id="map-pins-panel"
            // className="mx_MapPinsCard"
            // ariaLabelledBy="room-summary-panel-tab"
            role="tabpanel"
            header={header}
            // header={_t("map_pins|right_panel|header_title")}
            withoutScrollContainer={true}
        >
            <div ref={mapContainerRef} className="mx_MapPins_map"/>
        </BaseCard>
    )
}

export default MapPinsCard;
