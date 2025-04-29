// eslint-disable-next-line matrix-org/require-copyright-header
import React, {type ReactNode} from "react";
import {
    type MatrixEvent,
    type MatrixClient,
    type Stream,
    StreamEvent,
} from "matrix-js-sdk/src/matrix";

import {_t} from "../../../languageHandler";
import Modal from "../../../Modal";
import {type IBodyProps} from "./IBodyProps";
import MatrixClientContext from "../../../contexts/MatrixClientContext";
import {type GetRelationsForEvent} from "../rooms/EventTile";
import {MatrixClientPeg} from "../../../MatrixClientPeg";
import StreamCreateDialog from "../elements/StreamCreateDialog.tsx";

interface IState {
    stream?: Stream;
    // stream instance has fetched at least one page of responses
    streamInitialised: boolean;
}


export function isStreamEnded(streamEvent: MatrixEvent, matrixClient: MatrixClient): boolean {
    const room = matrixClient.getRoom(streamEvent.getRoomId());
    const stream = room?.streams.get(streamEvent.getId()!);
    if (!stream) {
        return false;
    }
    return stream.isEnded;
}

export function launchStreamEditor(mxEvent: MatrixEvent, getRelationsForEvent?: GetRelationsForEvent): void {
    const room = MatrixClientPeg.safeGet().getRoom(mxEvent.getRoomId());
    if (room) {
        Modal.createDialog(
            StreamCreateDialog,
            {
                room,
                editingMxEvent: mxEvent,
            },
            "mx_CompoundDialog",
            false, // isPriorityModal
            true, // isStaticModal
        );
    }
}

export default class MStreamBody extends React.Component<IBodyProps, IState> {
    public static contextType = MatrixClientContext;
    declare public context: React.ContextType<typeof MatrixClientContext>;

    public constructor(props: IBodyProps) {
        super(props);

        this.state = {
            streamInitialised: false,
        };
    }

    public componentDidMount(): void {
        const room = this.context?.getRoom(this.props.mxEvent.getRoomId());
        const stream = room?.streams.get(this.props.mxEvent.getId()!);
        if (stream) {
            this.setStreamInstance(stream);
        } else {
            room?.on(StreamEvent.New, this.setStreamInstance.bind(this));
        }
    }

    public componentWillUnmount(): void {
        this.removeListeners();
    }

    private async setStreamInstance(stream: Stream): Promise<void> {
        if (stream.streamId !== this.props.mxEvent.getId()) {
            return;
        }
        this.setState({stream}, () => {
            this.addListeners();
        });

        this.setState({streamInitialised: true});
    }

    private addListeners(): void {
        this.state.stream?.on(StreamEvent.UndecryptableRelations, this.render.bind(this));
    }

    private removeListeners(): void {
        if (this.state.stream) {
            this.state.stream.off(StreamEvent.UndecryptableRelations, this.render.bind(this));
        }
    }

    private getStreamViewerUrl(streamApp: string, streamId: string): string {
        return `http://t3.rpipro.xyz:4567/player.html?app=${streamApp}&stream=${streamId}`
    }

    public render(): ReactNode {
        const {stream} = this.state;
        if (!stream?.streamEvent) {
            return null;
        }

        const streamEvent = stream.streamEvent;

        // const editedSpan = this.props.mxEvent.replacingEvent() ? (
        //     <span className="mx_MStreamBody_edited"> ({_t("common|edited")})</span>
        // ) : null;

        const streamUrl = this.getStreamViewerUrl(
            streamEvent.stream_app.text,
            streamEvent.stream_id.text
        )

        const openInNewTab = (url: string): void => {
            const newWindow = window.open(url, '_blank', 'width=496,height=892')
            if (newWindow) newWindow.opener = null
        }

        const onClickUrl = (): (() => void) => () => openInNewTab(streamUrl)

        const thirdPartyStreamInfo = (
            <div>
                {_t("stream|third_party_stream_info")}
                <br /><br />
                {_t("stream|third_party_srt_stream_info", {
                    stream_app: streamEvent.stream_app.text,
                    stream_id: streamEvent.stream_id.text
                })}
                <br /><br />
                {_t("stream|third_party_rtmp_stream_info", {
                    stream_app: streamEvent.stream_app.text,
                    stream_id: streamEvent.stream_id.text
                })}
            </div>
        )

        return (
            <div className="mx_MStreamBody">
                <h4 data-testid="streamDescription">
                    {(streamEvent.third_party ?
                                _t("stream|message_header_third_party_stream") :
                                _t("stream|message_header_user_stream")
                        )
                        + streamEvent.description.text}

                    <br />
                    {streamEvent.third_party? thirdPartyStreamInfo : undefined}
                </h4>

                <div>
                    <button onClick={onClickUrl()}>{_t("stream|view_stream")}</button>
                </div>
            </div>
        );
    }
}
