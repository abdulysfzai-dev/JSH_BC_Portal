// "Invite to Portal" on the Customer card and list. Adds an action only; nothing else changes.
pageextension 99704 "JSHP Customer Card" extends "Customer Card"
{
    actions
    {
        addlast(processing)
        {
            action(JSHPInviteToPortal)
            {
                ApplicationArea = All;
                Caption = 'Invite to Portal';
                Image = SendTo;
                ToolTip = 'Invite this customer''s people to the JSH Trade Portal, or send someone a new invite.';
                trigger OnAction()
                var
                    PortalInvite: Codeunit "JSHP Portal Invite";
                begin
                    PortalInvite.InviteFromCustomer(Rec);
                end;
            }
        }
    }
}

pageextension 99705 "JSHP Customer List" extends "Customer List"
{
    actions
    {
        addlast(processing)
        {
            action(JSHPInviteToPortal)
            {
                ApplicationArea = All;
                Caption = 'Invite to Portal';
                Image = SendTo;
                ToolTip = 'Invite this customer''s people to the JSH Trade Portal, or send someone a new invite.';
                trigger OnAction()
                var
                    PortalInvite: Codeunit "JSHP Portal Invite";
                begin
                    PortalInvite.InviteFromCustomer(Rec);
                end;
            }
        }
    }
}
