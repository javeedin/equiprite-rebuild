define([], function () {
  'use strict';

  // The rental terms a customer accepts before a request is submitted (the terms-and-conditions gate). Text copied
  // word for word from Old EquipRite's cart dialog (flows/customer-portal/pages/request-cart-page.html, #termsDialog),
  // as data so New request (customer) and the Rental contract page show the same words. Change it in both apps or not
  // at all: the customer accepted this text.
  //
  // Each section: { title, paras: [{ text, lead?, bullet? }] }. `lead` is the bold run-in heading of a paragraph.
  var INTRO = [
    "Please read the following Terms and Conditions carefully before submitting your equipment rental request. By proceeding, you acknowledge that you have read, understood, and agree to be bound by all provisions set forth herein.",
    "This Equipment Rental Agreement (\"Agreement\") is entered into between Rite Software Solutions (\"Company\" or \"Rental Provider\") and the customer identified in the rental request (\"Customer\" or \"you\"). These Terms and Conditions govern all equipment rentals facilitated through the EquipRite platform and constitute a legally binding contract upon acceptance."
  ];

  var SECTIONS = [
    {
      "title": "1. Acceptance of Delivery and Transfer of Risk",
      "paras": [
        {
          "text": "The Customer shall be deemed to have accepted delivery of the Equipment, and all associated risk of loss, damage, or destruction shall transfer to the Customer, at the moment the Equipment is collected, dispatched, or otherwise made available for the Customer's use. The Customer is solely responsible for conducting a thorough inspection of all Equipment upon receipt. Any defects, damage, or operational deficiencies must be reported to the Rental Provider in writing within twenty-four (24) hours of delivery. Failure to provide timely notification shall constitute the Customer's unconditional acceptance that the Equipment is in satisfactory working condition."
        }
      ]
    },
    {
      "title": "2. Transportation, Collection and Return of Equipment",
      "paras": [
        {
          "text": "Unless otherwise agreed in writing, the Customer shall be responsible for the collection and return of all Equipment during standard business hours (9:00 AM – 5:00 PM, Monday through Friday). Where transportation arrangements are made at the Customer's request, all associated costs — including but not limited to freight charges, applicable taxes, customs duties, brokerage fees, and transit insurance — shall be borne exclusively by the Customer."
        },
        {
          "text": "The Rental Provider accepts no liability for delays, damage, or loss arising during transit once Equipment has been transferred to a designated carrier. Collect shipments will not be accepted under any circumstances."
        }
      ]
    },
    {
      "title": "3. Customer Obligations and Responsibilities",
      "paras": [
        {
          "text": "From the time of delivery until the formal return and acceptance of the Equipment by the Rental Provider, the Customer assumes full and exclusive responsibility for the Equipment, including all risks of loss, theft, accidental damage, and destruction, whether on the Customer's premises, in transit, or at any other location."
        },
        {
          "text": "Equipment shall not be considered returned until each of the following conditions has been fully satisfied:"
        },
        {
          "bullet": true,
          "text": "The Equipment has been physically returned to the Rental Provider's designated premises during business hours;"
        },
        {
          "bullet": true,
          "text": "A comprehensive inventory inspection has been completed and documented by authorised personnel; and"
        },
        {
          "bullet": true,
          "text": "The agreed rental term, as specified in the Rental Contract, has fully elapsed."
        }
      ]
    },
    {
      "title": "4. Authorised Use and Restrictions",
      "paras": [
        {
          "lead": "Qualified Personnel Only.",
          "text": "All Equipment must be operated exclusively by suitably qualified and authorised employees or agents of the Customer, strictly in accordance with the intended purpose specified in the Rental Contract and in full compliance with all applicable laws, regulations, and safety standards."
        },
        {
          "lead": "Prohibition on Sub-Leasing.",
          "text": "The Customer is expressly prohibited from sub-leasing, lending, transferring, or otherwise making available any Equipment to any third party without the prior written consent of the Rental Provider."
        },
        {
          "lead": "Preservation of Identification Markings.",
          "text": "The Customer shall not remove, obscure, alter, or deface any serial numbers, asset tags, nameplates, barcodes, or proprietary logos affixed to the Equipment."
        },
        {
          "lead": "Disclaimer of Warranties.",
          "text": "To the fullest extent permitted by applicable law, all Equipment is provided on an \"as-is\" basis. The Rental Provider makes no representations or warranties, express or implied, including without limitation any implied warranties of merchantability or fitness for a particular purpose, except as explicitly agreed in writing."
        }
      ]
    },
    {
      "title": "5. Loss, Damage and Equipment Liability",
      "paras": [
        {
          "lead": "Reporting Obligations.",
          "text": "The Customer must notify the Rental Provider immediately upon discovering any malfunction, damage, loss, or theft of Equipment. In cases of theft or unexplained disappearance, the Customer must also file a formal report with the relevant law enforcement authorities and provide a copy thereof to the Rental Provider without delay."
        },
        {
          "lead": "Assessment of Damage.",
          "text": "Upon return of damaged Equipment, the Rental Provider shall conduct a professional assessment to determine the nature and extent of damage and the appropriate remedy — whether repair or full replacement. The Rental Provider's determination in this regard shall be final and binding upon the Customer."
        },
        {
          "lead": "Financial Liability.",
          "text": "Where Equipment is determined to require replacement due to loss, theft, or irreparable damage attributable to the Customer, the Customer shall be liable for the full replacement cost at current market retail prices, without deduction for depreciation, less any applicable discounts."
        }
      ]
    },
    {
      "title": "6. Rental Charges, Overdue Returns and Late Fees",
      "paras": [
        {
          "text": "The Customer is obligated to return all Equipment no later than the date and time specified in the Rental Contract. A grace period of up to 12:00 Noon on the following business day is permitted; thereafter, a full additional day's rental charge shall apply for each day or part thereof that the Equipment remains unreturned."
        },
        {
          "text": "Where Equipment is returned in a damaged or non-operational condition, rental charges shall continue to accrue at the standard daily rate applicable to the affected items until such time as the necessary repairs or replacements are completed and the invoice for damages has been settled in full, irrespective of any package or promotional discounts previously applied."
        }
      ]
    },
    {
      "title": "7. Payment Terms and Credit Obligations",
      "paras": [
        {
          "text": "All rental and damage invoices are due and payable upon receipt and must be settled no later than ten (10) calendar days from the invoice date. Amounts outstanding beyond thirty (30) days shall be deemed past due and may attract late payment charges in accordance with applicable legislation."
        },
        {
          "text": "The Customer acknowledges that payment terms are extended based on credit information provided at the time of rental. Any material change in the Customer's financial standing or creditworthiness may result in an immediate demand for payment at the Rental Provider's sole discretion. In the event that the account is referred to a collection agency or legal counsel, the Customer shall be liable for all associated recovery costs, including reasonable legal fees and court costs."
        }
      ]
    },
    {
      "title": "8. Cancellation Policy",
      "paras": [
        {
          "text": "Cancellation of a confirmed rental request may result in cancellation charges commensurate with the Rental Provider's preparatory costs, equipment reservation commitments, and any sub-rental arrangements made on the Customer's behalf. The Customer is encouraged to communicate any changes to their requirements at the earliest opportunity to minimise or avoid such charges."
        }
      ]
    },
    {
      "title": "9. Insurance Obligations",
      "paras": [
        {
          "text": "The Customer shall, at its own cost and expense, procure and maintain comprehensive insurance coverage for all rented Equipment throughout the full duration of the rental period, commencing from the time of delivery and continuing until formal acceptance of return by the Rental Provider. Coverage must be for the full replacement value of the Equipment."
        },
        {
          "lead": "Property Insurance.",
          "text": "The Customer's property insurance policy shall be on an \"All Risks\" basis, name the Rental Provider as Loss Payee, operate on a worldwide basis, and provide minimum coverage of USD $1,000,000, sufficient to encompass all Equipment at risk regardless of source."
        },
        {
          "lead": "Liability Insurance.",
          "text": "The Customer shall name the Rental Provider as an Additional Insured on its Commercial General Liability policy, with minimum limits of USD $1,000,000 per occurrence and in the annual aggregate. Automobile Liability coverage of no less than USD $1,000,000 combined single limit is also required. All policies shall provide for not less than ten (10) days' written notice to the Rental Provider prior to modification or cancellation."
        }
      ]
    },
    {
      "title": "10. Title, Ownership and Right of Inspection",
      "paras": [
        {
          "text": "Title and ownership of all Equipment shall at all times remain exclusively vested in the Rental Provider. The Customer shall not create, permit, or suffer any lien, encumbrance, charge, or security interest over the Equipment and shall not pledge or assign the Equipment or any interest therein to any third party."
        },
        {
          "text": "The Rental Provider reserves the right, without prior notice, to inspect the Equipment at any time during the rental period. In the event of any breach of this Agreement by the Customer, the Rental Provider shall be entitled to repossess the Equipment forthwith without prejudice to any other rights or remedies available at law."
        }
      ]
    },
    {
      "title": "11. Indemnification",
      "paras": [
        {
          "text": "The Customer agrees to fully indemnify, defend, and hold harmless the Rental Provider and its officers, directors, employees, and agents from and against any and all claims, liabilities, losses, damages, costs, and expenses (including reasonable legal fees) arising out of or in connection with the Customer's possession, use, operation, or return of the Equipment during the rental period, including any claims arising from the negligence of the Customer or its personnel."
        }
      ]
    },
    {
      "title": "12. Governing Law and Entire Agreement",
      "paras": [
        {
          "text": "This Agreement shall be construed and governed in accordance with the laws of the State of Florida, without regard to its conflict of law provisions. Any disputes arising hereunder shall be subject to the exclusive jurisdiction of the courts of Orange County, Florida."
        },
        {
          "text": "This Agreement, together with the associated Rental Contract, constitutes the entire agreement between the parties with respect to the subject matter hereof and supersedes all prior negotiations, representations, warranties, and understandings. No amendment to this Agreement shall be effective unless made in writing and duly executed by authorised representatives of both parties."
        },
        {
          "text": "Where an individual executes this Agreement on behalf of a corporation or other legal entity, such individual warrants that they possess full authority to bind such entity to the terms herein."
        }
      ]
    }
  ];

  // The checkbox label of the old dialog.
  var AGREE_LABEL = 'I have read and agree to the above Rental Terms and Conditions';

  return { INTRO: INTRO, SECTIONS: SECTIONS, AGREE_LABEL: AGREE_LABEL };
});
