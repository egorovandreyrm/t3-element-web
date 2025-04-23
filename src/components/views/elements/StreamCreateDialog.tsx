// eslint-disable-next-line matrix-org/require-copyright-header
import {
    type IPartialEvent,
    type MatrixEvent,
    type Room,
    type TimelineEvents
} from "matrix-js-sdk/src/matrix";
import { StreamStartEvent } from "matrix-js-sdk/src/extensible_events_v1/StreamStartEvent";
import React, {type ChangeEvent} from "react";

import ScrollableBaseModal, {type IScrollableBaseState} from "../dialogs/ScrollableBaseModal.tsx";
import {_t} from "../../../languageHandler.tsx";
import {doMaybeLocalRoomAction} from "../../../utils/local-room.ts";
import Modal from "../../../Modal.tsx";
import QuestionDialog from "../dialogs/QuestionDialog.tsx";
import Field from "./Field.tsx";
import Spinner from "./Spinner.tsx";


interface IProps {
    room: Room;
    editingMxEvent?: MatrixEvent; // Truthy if we are editing an existing stream
    onFinished(streamCreated?: boolean): void;
}

enum FocusTarget {
    Description,
    Url,
}

interface IState extends IScrollableBaseState {
    description: string;
    url: string;
    busy: boolean;
    autoFocusTarget: FocusTarget;
}

const MAX_DESCRIPTION_LENGTH = 340;
const MAX_URL_LENGTH = 340;

function creatingInitialState(): IState {
    return {
        title: _t("stream|create_stream_title"),
        actionLabel: _t("stream|create_stream_action"),
        canSubmit: false, // need to add a question and at least one option first
        description: "",
        url: "",
        busy: false,
        autoFocusTarget: FocusTarget.Description,
    };
}

function editingInitialState(editingMxEvent: MatrixEvent): IState {
    // const poll = editingMxEvent.unstableExtensibleEvent as PollStartEvent;
    // if (!poll?.isEquivalentTo(M_POLL_START)) return creatingInitialState();

    return {
        title: _t("stream|edit_stream_title"),
        actionLabel: _t("action|done"),
        canSubmit: true,
        description: "",//poll.question.text,
        url: "",
        busy: false,
        autoFocusTarget: FocusTarget.Description
    };
}

export default class StreamCreateDialog extends ScrollableBaseModal<IProps, IState> {
    public constructor(props: IProps) {
        super(props);

        this.state = props.editingMxEvent ? editingInitialState(props.editingMxEvent) : creatingInitialState();
    }

    private checkCanSubmit(): void {
        this.setState({
            canSubmit:
                this.state.description.trim().length > 0 &&
                this.state.url.trim().length > 0
        });
    }

    private onDescriptionChange = (e: ChangeEvent<HTMLInputElement>): void => {
        this.setState({ description: e.target.value }, () => this.checkCanSubmit());
    };

    private onUrlChange = (e: ChangeEvent<HTMLInputElement>): void => {
        this.setState({ url: e.target.value }, () => this.checkCanSubmit());
    };

    private createEvent(): IPartialEvent<object> {
        const streamStart = StreamStartEvent.from(
            this.state.description,
            this.state.url,
            true
        ).serialize();

        if (!this.props.editingMxEvent) {
            return streamStart;
        } else {
            return {
                content: {
                    "m.new_content": streamStart.content,
                    "m.relates_to": {
                        rel_type: "m.replace",
                        event_id: this.props.editingMxEvent.getId(),
                    },
                },
                type: streamStart.type,
            };
        }
    }

    protected submit(): void {
        this.setState({ busy: true, canSubmit: false });

        const streamEvent = this.createEvent();
        doMaybeLocalRoomAction(
            this.props.room.roomId,
            (actualRoomId: string) =>
                this.matrixClient.sendEvent(
                    actualRoomId,
                    null,
                    streamEvent.type as keyof TimelineEvents,
                    streamEvent.content as TimelineEvents[keyof TimelineEvents],
                ),
            this.matrixClient,
        )
            .then(() => this.props.onFinished(true))
            .catch((e) => {
                console.error("Failed to post stream:", e);
                Modal.createDialog(QuestionDialog, {
                    title: _t("stream|failed_send_stream_title"),
                    description: _t("stream|failed_send_stream_description"),
                    button: _t("action|try_again"),
                    cancelButton: _t("action|cancel"),
                    onFinished: (tryAgain: boolean) => {
                        if (!tryAgain) {
                            this.cancel();
                        } else {
                            this.setState({ busy: false, canSubmit: true });
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
                <h2>{_t("stream|description_heading")}</h2>
                <Field
                    id="stream-description-input"
                    value={this.state.description}
                    maxLength={MAX_DESCRIPTION_LENGTH}
                    placeholder={_t("stream|description_placeholder")}
                    onChange={this.onDescriptionChange}
                    usePlaceholderAsHint={true}
                    disabled={this.state.busy}
                    autoFocus={this.state.autoFocusTarget === FocusTarget.Description}
                />

                <h2>{_t("stream|url_heading")}</h2>
                <Field
                    id="stream-url-input"
                    value={this.state.url}
                    maxLength={MAX_URL_LENGTH}
                    placeholder={_t("stream|url_placeholder")}
                    onChange={this.onUrlChange}
                    usePlaceholderAsHint={true}
                    disabled={this.state.busy}
                    autoFocus={this.state.autoFocusTarget === FocusTarget.Url}
                />

                {this.state.busy && (
                    <div className="mx_PollCreateDialog_busy">
                        <Spinner />
                    </div>
                )}
            </div>
        );
    }
}
