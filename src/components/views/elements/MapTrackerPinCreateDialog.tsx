import type {IPartialEvent, MatrixEvent, Room, TimelineEvents} from "matrix-js-sdk/src/matrix.ts";
import ScrollableBaseModal, {IScrollableBaseState} from "../dialogs/ScrollableBaseModal.tsx";
import {_t} from "../../../languageHandler.tsx";
import React, {ChangeEvent} from "react";
import {MessageEvent as MatrixMessageEvent} from "matrix-js-sdk/src/extensible_events_v1/MessageEvent.ts";
import axios from "axios";
import {doMaybeLocalRoomAction} from "../../../utils/local-room.ts";
import Modal from "../../../Modal.tsx";
import QuestionDialog from "../dialogs/QuestionDialog.tsx";
import Field from "./Field.tsx";
import Spinner from "./Spinner.tsx";
import {MapPinDto} from "../right_panel/map-pin.dto.ts";

interface IProps {
    room: Room;
    editingMxEvent?: MatrixEvent; // Truthy if we are editing an existing stream
    onFinished(mapPinCreated?: boolean): void;
}

enum FocusTarget {
    Name,
}

interface IState extends IScrollableBaseState {
    name: string;
    busy: boolean;
    autoFocusTarget: FocusTarget;
}

interface AddMapTrackerPinDto {
    room_id: string
    name: string
}

const MAX_NAME_LENGTH = 340;

function creatingInitialState(props: IProps): IState {
    return {
        title: _t("map_pin|create_map_tracker_pin_title"),
        actionLabel: _t("map_pin|create_map_tracker_pin_action"),
        canSubmit: false, // need to add a question and at least one option first
        name: "",
        busy: false,
        autoFocusTarget: FocusTarget.Name,
    };
}

function editingInitialState(props: IProps): IState {
    // const poll = editingMxEvent.unstableExtensibleEvent as PollStartEvent;
    // if (!poll?.isEquivalentTo(M_POLL_START)) return creatingInitialState();

    return {
        title: _t("map_pin|edit_map_tracker_pin_title"),
        actionLabel: _t("action|done"),
        canSubmit: true,
        name: "",
        busy: false,
        autoFocusTarget: FocusTarget.Name
    };
}

export default class MapTrackerPinCreateDialog extends ScrollableBaseModal<IProps, IState> {
    public constructor(props: IProps) {
        super(props);

        this.state = props.editingMxEvent ? editingInitialState(props) : creatingInitialState(props);
    }

    private checkCanSubmit(): void {
        this.setState({canSubmit: this.state.name.trim().length > 0});
    }

    private onNameChange = (e: ChangeEvent<HTMLInputElement>): void => {
        this.setState({name: e.target.value}, () => this.checkCanSubmit());
    };

    private createEvent(mapPinId: number): IPartialEvent<object> {
        const updateLocationInfoUrl = `http://t3.rpipro.xyz:5055/api/v1/traccar?id=${mapPinId}&lon=55.277288&lat=25.197081&timestamp=202134.000`;

        const messageEvent = MatrixMessageEvent.from(
            `Added Map Tracker Pin: name: ${this.state.name}, id: ${mapPinId}, locations can be posted like this: POST ${updateLocationInfoUrl}`
        ).serialize();

        if (!this.props.editingMxEvent) {
            return messageEvent;
        } else {
            return {
                content: {
                    "m.new_content": messageEvent.content,
                    "m.relates_to": {
                        rel_type: "m.replace",
                        event_id: this.props.editingMxEvent.getId(),
                    },
                },
                type: messageEvent.type,
            };
        }
    }

    private async addMapPin(): Promise<MapPinDto> {
        const MAP_PINS_API_URL = `http://t3.rpipro.xyz:5055/api/v1/map/pins/tracker`;
        const MAP_PINS_API_KEY = 'root';

        // room_id: string
        // name: string
        // longitude: number
        // latitude: number

        const dto: AddMapTrackerPinDto = {
            room_id: this.props.room.roomId,
            name: this.state.name
        }

        const response = await axios.post(
            MAP_PINS_API_URL,
            dto,
            {
                headers: {"authorization": `key=${MAP_PINS_API_KEY}`},
                timeout: 2000
            }
        )

        return response.data
    }

    protected submit(): void {
        this.setState({busy: true, canSubmit: false});

        doMaybeLocalRoomAction(
            this.props.room.roomId,
            async (actualRoomId: string) => {
                const mapPinDto = await this.addMapPin()

                const event = this.createEvent(mapPinDto.id);

                return this.matrixClient.sendEvent(
                    actualRoomId,
                    null,
                    event.type as keyof TimelineEvents,
                    event.content as TimelineEvents[keyof TimelineEvents],
                )
            },
            this.matrixClient,
        )
            .then(() => this.props.onFinished(true))
            .catch((e) => {
                console.error("Failed to post map pin:", e);
                Modal.createDialog(QuestionDialog, {
                    title: _t("map_pin|failed_send_map_pin_title"),
                    description: _t("map_pin|failed_send_map_pin_description"),
                    button: _t("action|try_again"),
                    cancelButton: _t("action|cancel"),
                    onFinished: (tryAgain: boolean) => {
                        if (!tryAgain) {
                            this.cancel();
                        } else {
                            this.setState({busy: false, canSubmit: true});
                        }
                    },
                });
            });
    }

    protected cancel(): void {
        this.props.onFinished(false);
    }

    protected renderContent(): React.ReactNode {
        return (
            <div className="mx_PollCreateDialog">
                <h2>{_t("map_pin|name_heading")}</h2>
                <Field
                    id="map-pin-name-input"
                    value={this.state.name}
                    maxLength={MAX_NAME_LENGTH}
                    placeholder={_t("map_pin|tracker_name_placeholder")}
                    onChange={this.onNameChange}
                    usePlaceholderAsHint={true}
                    disabled={this.state.busy}
                    autoFocus={this.state.autoFocusTarget === FocusTarget.Name}
                />

                {this.state.busy && (
                    <div className="mx_PollCreateDialog_busy">
                        <Spinner/>
                    </div>
                )}
            </div>
        );
    }
}
